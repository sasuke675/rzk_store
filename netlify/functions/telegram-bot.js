export async function handler(event, context) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing environment variables for telegram-bot.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error: Missing configurations' }),
    };
  }

  // Hanya menerima metode POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Bad Request: Invalid JSON body' }),
    };
  }

  // 1. SKENARIO: Pengiriman Notifikasi Baru (dipicu dari Frontend)
  if (body.action === 'send_notification') {
    const { transaction, product_name } = body;
    if (!transaction || !product_name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Bad Request: Missing transaction or product_name' }),
      };
    }

    const txId = transaction.id;
    const amountFormatted = Number(transaction.amount).toLocaleString('id-ID');
    const messageText = `<b>🆕 PESANAN BARU MASUK</b>\n\n` +
      `👤 <b>Nama Pembeli:</b> ${transaction.buyer_name}\n` +
      `📧 <b>Email:</b> ${transaction.buyer_email}\n` +
      `📞 <b>No. HP:</b> ${transaction.buyer_phone}\n` +
      `📦 <b>Produk:</b> ${product_name}\n` +
      `💰 <b>Total Bayar:</b> Rp ${amountFormatted}\n` +
      `🔑 <b>ID Transaksi:</b> <code>${txId}</code>\n\n` +
      `Silakan verifikasi pembayaran di bawah ini (Maksimal 20 menit).`;

    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
      const response = await fetch(telegramUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: messageText,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Verifikasi', callback_data: `verify:${txId}` },
                { text: '❌ Tolak', callback_data: `reject:${txId}` }
              ]
            ]
          }
        })
      });

      const resData = await response.json();
      if (!resData.ok) {
        console.error('Failed to send Telegram message:', resData);
        throw new Error(resData.description || 'Telegram sendMessage failed');
      }

      const messageId = resData.result.message_id;

      // Simpan telegram_message_id ke Supabase
      const updateUrl = `${supabaseUrl}/rest/v1/transactions?id=eq.${txId}`;
      const updateRes = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          telegram_message_id: String(messageId)
        })
      });

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        console.error('Failed to save telegram_message_id to Supabase:', errText);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ status: 'success', message_id: messageId }),
      };

    } catch (err) {
      console.error('Error sending Telegram notification:', err.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  // 2. SKENARIO: Telegram Webhook Update (Admin menekan tombol Verifikasi/Tolak)
  if (body.callback_query) {
    const callbackQuery = body.callback_query;
    const callbackData = callbackQuery.data; // format: "verify:tx_uuid" atau "reject:tx_uuid"
    const callbackQueryId = callbackQuery.id;
    const message = callbackQuery.message;
    const originalText = message.text || '';

    // Validasi Keamanan: Pastikan asal request dari Chat ID Admin yang terdaftar
    const incomingChatId = String(message.chat.id);
    if (incomingChatId !== String(TELEGRAM_CHAT_ID)) {
      console.warn(`Unauthorized callback query from chat ID: ${incomingChatId}`);
      await answerTelegramCallback(callbackQueryId, 'Akses Ditolak: Anda bukan Admin!');
      return { statusCode: 200, body: 'Unauthorized' };
    }

    if (!callbackData || !callbackData.includes(':')) {
      await answerTelegramCallback(callbackQueryId, 'Format callback data tidak valid.');
      return { statusCode: 200, body: 'Invalid callback data' };
    }

    const [action, txId] = callbackData.split(':');

    // 1. Ambil data transaksi dari Supabase untuk memeriksa status & waktu dibuat
    const queryUrl = `${supabaseUrl}/rest/v1/transactions?id=eq.${txId}&limit=1`;
    let tx;
    try {
      const res = await fetch(queryUrl, {
        method: 'GET',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        }
      });
      const txData = await res.json();
      if (!txData || txData.length === 0) {
        throw new Error('Transaction not found');
      }
      tx = txData[0];
    } catch (err) {
      console.error('Error fetching transaction:', err.message);
      await answerTelegramCallback(callbackQueryId, 'Transaksi tidak ditemukan di database.');
      // Hapus tombol agar tidak dicoba lagi
      await editTelegramMessageMarkup(message.chat.id, message.message_id, null);
      return { statusCode: 200, body: 'Transaction not found' };
    }

    // 2. Cek apakah transaksi sudah kadaluarsa (> 20 menit)
    const createdAt = new Date(tx.created_at).getTime();
    const now = Date.now();
    const elapsedMinutes = (now - createdAt) / (1000 * 60);

    if (elapsedMinutes > 20) {
      // Jika masih pending, ubah status di DB ke expired
      if (tx.status === 'pending') {
        await updateTransactionStatus(txId, 'expired');
      }
      await answerTelegramCallback(callbackQueryId, 'Gagal: Transaksi sudah kadaluarsa (lebih dari 20 menit)!');
      // Update pesan Telegram untuk menghapus tombol dan memberi keterangan expired
      const expiredText = `${originalText}\n\n⚠️ <b>STATUS: EXPIRED (MELEBIHI 20 MENIT)</b>`;
      await editTelegramMessageText(message.chat.id, message.message_id, expiredText, null);
      return { statusCode: 200, body: 'Transaction expired' };
    }

    // 3. Cek jika transaksi sudah pernah diproses sebelumnya (paid / expired)
    if (tx.status === 'paid') {
      await answerTelegramCallback(callbackQueryId, 'Transaksi ini sudah lunas diverifikasi.');
      const verifiedText = `${originalText}\n\n✅ <b>STATUS: BERHASIL DIVERIFIKASI</b>`;
      await editTelegramMessageText(message.chat.id, message.message_id, verifiedText, null);
      return { statusCode: 200, body: 'Already paid' };
    } else if (tx.status === 'expired') {
      await answerTelegramCallback(callbackQueryId, 'Transaksi ini sudah ditolak/kadaluarsa.');
      const rejectedText = `${originalText}\n\n❌ <b>STATUS: DITOLAK / EXPIRED</b>`;
      await editTelegramMessageText(message.chat.id, message.message_id, rejectedText, null);
      return { statusCode: 200, body: 'Already expired' };
    }

    // 4. Proses Verifikasi / Penolakan
    if (action === 'verify') {
      // Update status ke paid di database
      const success = await updateTransactionStatus(txId, 'paid');
      if (success) {
        await answerTelegramCallback(callbackQueryId, 'Transaksi berhasil diverifikasi sebagai Lunas! ✅');
        const verifiedText = `${originalText}\n\n✅ <b>STATUS: BERHASIL DIVERIFIKASI</b>`;
        await editTelegramMessageText(message.chat.id, message.message_id, verifiedText, null);
      } else {
        await answerTelegramCallback(callbackQueryId, 'Gagal mengupdate database.');
      }
    } else if (action === 'reject') {
      // Update status ke expired (ditolak) di database
      const success = await updateTransactionStatus(txId, 'expired');
      if (success) {
        await answerTelegramCallback(callbackQueryId, 'Transaksi ditolak! ❌');
        const rejectedText = `${originalText}\n\n❌ <b>STATUS: DITOLAK</b>`;
        await editTelegramMessageText(message.chat.id, message.message_id, rejectedText, null);
      } else {
        await answerTelegramCallback(callbackQueryId, 'Gagal mengupdate database.');
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'success' }),
    };
  }

  // Jika request tidak cocok dengan skenario di atas
  return {
    statusCode: 400,
    body: JSON.stringify({ error: 'Bad Request: Unknown event type' }),
  };

  // --- HELPER FUNCTIONS ---

  async function updateTransactionStatus(id, status) {
    const updateUrl = `${supabaseUrl}/rest/v1/transactions?id=eq.${id}`;
    try {
      const res = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: status,
          updated_at: new Date().toISOString()
        })
      });
      return res.ok;
    } catch (err) {
      console.error('Failed to update transaction status:', err.message);
      return false;
    }
  }

  async function answerTelegramCallback(callbackQueryId, text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: text,
          show_alert: false
        })
      });
    } catch (err) {
      console.error('Failed to answer callback query:', err.message);
    }
  }

  async function editTelegramMessageMarkup(chatId, messageId, replyMarkup) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: replyMarkup || { inline_keyboard: [] }
        })
      });
    } catch (err) {
      console.error('Failed to edit message markup:', err.message);
    }
  }

  async function editTelegramMessageText(chatId, messageId, text, replyMarkup) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup || { inline_keyboard: [] }
        })
      });
    } catch (err) {
      console.error('Failed to edit message text:', err.message);
    }
  }
}
