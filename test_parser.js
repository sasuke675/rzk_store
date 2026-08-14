// Skrip Pengujian Parsing Notifikasi DANA Bisnis
function parseAmountFromText(rawText) {
  if (!rawText) return null;

  // Regex untuk mengambil nominal uang dari notifikasi DANA Bisnis
  const cleanedText = rawText.replace(/[\s\u00a0]/g, ' '); // normalisasi spasi
  const match = cleanedText.match(/(?:Rp\.?\s*)?([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+)/i);
  if (match) {
    return parseInt(match[1].replace(/\./g, ''), 10);
  }
  return null;
}

// Kasus Uji (Test Cases)
const testCases = [
  {
    input: "DANA Bisnis: Pembayaran sebesar Rp 15.021 dari BUDI SANTOSO berhasil.",
    expected: 15021
  },
  {
    input: "Anda menerima Rp. 10.005 dari DANA",
    expected: 10005
  },
  {
    input: "Pembayaran DANA Bisnis masuk Rp150.000",
    expected: 150000
  },
  {
    input: "Masuk Rp.2.500 dari OVO",
    expected: 2500
  },
  {
    input: "Nominal pembayaran Rp 5.012 sudah terverifikasi",
    expected: 5012
  }
];

console.log('=== PENGUJIAN PARSER NOTIFIKASI ===');
let passedCount = 0;

testCases.forEach((tc, idx) => {
  const result = parseAmountFromText(tc.input);
  const isPassed = result === tc.expected;
  if (isPassed) passedCount++;
  
  console.log(`Test #${idx + 1}: ${isPassed ? '[PASS]' : '[FAIL]'}`);
  console.log(`  Input   : "${tc.input}"`);
  console.log(`  Expected: ${tc.expected}`);
  console.log(`  Result  : ${result}`);
});

console.log(`\nHasil: ${passedCount}/${testCases.length} kasus uji berhasil.`);
