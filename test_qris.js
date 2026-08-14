// Skrip Pengujian QRIS Utility
import { generateDynamicQRIS } from './src/utils/qris.js';

// QRIS Statis Merchant Default (DANA Bisnis)
const staticQRIS = '00020101021126670014ID.CO.QRIS.WWW02150001234567890120303UMI51440014ID.CO.QRIS.WWW02150001234567890120303UMI5204573253033605802ID5909RZK STORE6007JAKARTA6304A850';
const testAmount = 15021; // Rp 15.021

console.log('=== PENGUJIAN UTILITY QRIS ===');
console.log('Static QRIS :', staticQRIS);
console.log('Nominal Uji :', testAmount);

try {
  const dynamicQRIS = generateDynamicQRIS(staticQRIS, testAmount);
  console.log('\nDynamic QRIS:', dynamicQRIS);

  // Verifikasi apakah tag 54 nominal sukses disisipkan
  if (dynamicQRIS.includes('540515021')) {
    console.log('\n[PASS] Tag 54 (Nominal) sukses disisipkan: "540515021"');
  } else {
    console.log('\n[FAIL] Tag 54 (Nominal) tidak ditemukan!');
  }

  // Verifikasi apakah tag 01 (point of initiation) diupdate ke 12 (dynamic)
  if (dynamicQRIS.includes('010212')) {
    console.log('[PASS] Tag 01 berhasil diubah menjadi dynamic: "010212"');
  } else {
    console.log('[FAIL] Tag 01 tidak diubah menjadi "010212"');
  }

  // Verifikasi apakah tag 63 CRC16 diletakkan di akhir dan panjangnya 4 char
  const crcTagIndex = dynamicQRIS.indexOf('6304');
  if (crcTagIndex !== -1 && crcTagIndex === dynamicQRIS.length - 8) {
    const crcValue = dynamicQRIS.substring(dynamicQRIS.length - 4);
    console.log(`[PASS] CRC-16 sukses dihitung di akhir: "${crcValue}"`);
  } else {
    console.log('[FAIL] Posisi CRC-16 salah atau tidak ditemukan!');
  }

} catch (err) {
  console.error('[ERROR] Terjadi kesalahan saat generate QRIS:', err);
}
