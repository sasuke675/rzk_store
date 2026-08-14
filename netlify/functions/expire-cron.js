export async function handler(event, context) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing configuration variables for expire-cron.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error: Missing configurations' }),
    };
  }

  // 1. Dapatkan batas waktu 20 menit yang lalu
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();

  // 2. Query transaksi pending yang berumur > 20 menit dari Supabase beserta nama produk
  const selectUrl = `${supabaseUrl}/rest/v1/transactions?select=*,products(name)&status=eq.pending&created_at=lt.${twentyMinutesAgo}`;
  let expiredTransactions = [];

  try {
    const res = await fetch(selectUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Failed to query expired transactions:', errText);
      throw new Error('Supabase query error');
    }

    expiredTransactions = await res.json();
  } catch (err) {
    console.error('Error fetching expired transactions:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Database query failure' }),
    };
  }

  console.log(`Found ${expiredTransactions.length} pending transactions older than 20 minutes.`);

  if (expiredTransactions.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'No expired transactions found.' }),
    };
  }

  let processedCount = 0;

  // 3. Proses masing-masing transaksi expired
  for (const tx of expiredTransactions) {
    const txId = tx.id;

    // A. Update status transaksi di database ke 'expired'
    const updateUrl = `${supabaseUrl}/rest/v1/transactions?id=eq.${txId}`;
    try {
      const updateRes = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: 'expired',
          updated_at: new Date().toISOString()
        })
      });

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        console.error(`Failed to update status for tx ${txId}:`, errText);
        continue; // lanjut ke transaksi berikutnya jika gagal update DB
      }

      processedCount++;

      // B. Update pesan Telegram jika telegram_message_id ada
      if (tx.telegram_message_id) {
        const productName = tx.products ? tx.products.name : 'Produk';
        const amountFormatted = Number(tx.amount).toLocaleString('id-ID');
        const expiredText = `<b>🆕 PESANAN BARU MASUK</b>\n\n` +
          `👤 <b>Nama Pembeli:</b> ${tx.buyer_name}\n` +
          `📧 <b>Email:</b> ${tx.buyer_email}\n` +
          `📞 <b>No. HP:</b> ${tx.buyer_phone}\n` +
          `📦 <b>Produk:</b> ${productName}\n` +
          `💰 <b>Total Bayar:</b> Rp ${amountFormatted}\n` +
          `🔑 <b>ID Transaksi:</b> <code>${txId}</code>\n\n` +
          `⚠️ <b>STATUS: EXPIRED (MELEBIHI 20 MENIT)</b>`;

        const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
        const telegramRes = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            message_id: Number(tx.telegram_message_id),
            text: expiredText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] } // Hapus tombol verifikasi/tolak
          })
        });

        const resData = await telegramRes.json();
        if (!resData.ok) {
          console.warn(`Failed to edit telegram message ${tx.telegram_message_id} for tx ${txId}:`, resData.description);
        }
      }
    } catch (err) {
      console.error(`Error processing expiration for tx ${txId}:`, err.message);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: `Successfully processed ${processedCount} expired transactions.`,
      count: processedCount
    }),
  };
}
