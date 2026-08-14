export async function handler(event, context) {
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

  // Verifikasi token keamanan dari berbagai kemungkinan Header & Body
  const expectedKey = process.env.CALLBACK_SECRET_KEY;
  
  // Ambil token dari header (case-insensitive)
  const headerKeys = [
    'x-callback-key', 'x-callback-signature', 'x-api-key', 'x-token', 'token', 'key', 'secret',
    'authorization'
  ];
  let incomingToken = '';
  for (const hk of headerKeys) {
    const val = event.headers[hk] || event.headers[hk.toLowerCase()] || event.headers[hk.toUpperCase()];
    if (val) {
      incomingToken = val;
      // Jika Bearer token format
      if (incomingToken.toLowerCase().startsWith('bearer ')) {
        incomingToken = incomingToken.substring(7).trim();
      }
      break;
    }
  }

  // Jika tidak ditemukan di header, coba cari di body JSON
  if (!incomingToken && body) {
    incomingToken = body.token || body.key || body.secret || body.secret_key || body.api_key || body.passcode || body.token_key;
  }

  // Bandingkan dengan key yang diharapkan
  if (!expectedKey || incomingToken !== expectedKey) {
    console.log('Unauthorized callback attempt. Received token:', incomingToken);
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized: Invalid callback token' }),
    };
  }

  // Ambil nominal dari payload JSON dari berbagai kemungkinan key name
  let amount = body.amount || body.nominal || body.value || body.price;
  
  // Cari teks notifikasi mentah dari berbagai kemungkinan key name
  const rawText = body.text || body.message || body.body || body.content || body.description || body.desc || body.notification || body.title;

  // Jika nominal tidak ada langsung tapi ada teks notifikasi, parse nominalnya
  if (!amount && rawText) {
    // Regex untuk mengambil nominal uang dari notifikasi DANA Bisnis
    // Contoh: "DANA Bisnis: Pembayaran masuk sebesar Rp 15.021" -> "15021"
    const cleanedText = String(rawText).replace(/[\s\u00a0]/g, ' '); // normalisasi spasi
    const match = cleanedText.match(/(?:Rp\.?\s*)?([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+)/i);
    if (match) {
      amount = parseInt(match[1].replace(/\./g, ''), 10);
    }
  }

  if (!amount) {
    // Cek apakah ini adalah request "Tes Koneksi" (biasanya tidak memiliki nominal pembayaran)
    const isTestRequest = 
      (rawText && /test|tes|ping|koneksi|hello|halo|notifsync/i.test(String(rawText))) ||
      (body && body.title && /test|tes|ping|koneksi|hello|halo|notifsync/i.test(String(body.title))) ||
      (body && body.message && /test|tes|ping|koneksi|hello|halo|notifsync/i.test(String(body.message)));

    if (isTestRequest) {
      console.log('Connection test request verified successfully.');
      return {
        statusCode: 200,
        body: JSON.stringify({
          status: 'success',
          message: 'Connection test successful'
        }),
      };
    }

    return {
      statusCode: 422,
      body: JSON.stringify({ error: 'Unprocessable Entity: Amount could not be resolved' }),
    };
  }

  // Ambil data environment variables Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error: Missing Supabase credentials' }),
    };
  }

  // Cari transaksi pending dengan nominal yang sama dalam 20 menit terakhir menggunakan Supabase REST API
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const queryUrl = `${supabaseUrl}/rest/v1/transactions?status=eq.pending&amount=eq.${amount}&created_at=gte.${twentyMinutesAgo}&order=created_at.desc&limit=1`;

  let transactionData;
  try {
    const res = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Supabase query error:', errText);
      throw new Error(`Supabase REST query failed with status ${res.status}`);
    }

    transactionData = await res.json();
  } catch (err) {
    console.error('Database fetch error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Database error while searching transaction' }),
    };
  }

  if (!transactionData || transactionData.length === 0) {
    console.log(`No pending transaction found for amount Rp ${amount}`);
    return {
      statusCode: 404,
      body: JSON.stringify({ 
        status: 'not_found', 
        message: `No matching pending transaction for amount ${amount} in last 20 minutes.` 
      }),
    };
  }

  const tx = transactionData[0];

  // Update status transaksi menjadi paid (lunas) menggunakan Supabase REST API
  const updateUrl = `${supabaseUrl}/rest/v1/transactions?id=eq.${tx.id}`;
  try {
    const res = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ 
        status: 'paid', 
        updated_at: new Date().toISOString() 
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Supabase update error:', errText);
      throw new Error(`Supabase REST update failed with status ${res.status}`);
    }
  } catch (err) {
    console.error('Database update error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Database error while updating transaction status' }),
    };
  }

  console.log(`Transaction ${tx.id} successfully paid with amount ${amount}`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      status: 'success',
      message: `Transaction ${tx.id} updated to paid.`,
      transaction_id: tx.id,
      amount: amount
    }),
  };
}
