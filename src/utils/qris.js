/**
 * Menghitung checksum CRC-16 CCITT (FALSE)
 * Digunakan untuk standard EMVCo/QRIS
 */
function calculateCRC16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    const charCode = str.charCodeAt(c);
    crc ^= (charCode << 8);
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = (crc << 1);
      }
    }
  }
  crc = crc & 0xFFFF;
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Mengubah QRIS Statis menjadi QRIS Dinamis dengan menyuntikkan nominal belanja
 * @param {string} staticQRIS - Payload QRIS statis dari merchant (DANA, OVO, LinkAja, dll)
 * @param {number|string} amount - Nominal belanja yang ingin disematkan (tanpa desimal)
 * @returns {string} Payload QRIS Dinamis yang sudah dihitung ulang CRC-nya
 */
export function generateDynamicQRIS(staticQRIS, amount) {
  if (!staticQRIS) return '';

  const tags = {};
  let i = 0;
  const qrisStr = staticQRIS.trim();

  // Parse QRIS String menjadi Object
  while (i < qrisStr.length) {
    const tagId = qrisStr.substring(i, i + 2);
    if (!tagId || tagId.length < 2) break;
    
    const lengthStr = qrisStr.substring(i + 2, i + 4);
    if (!lengthStr || lengthStr.length < 2) break;
    
    const length = parseInt(lengthStr, 10);
    const value = qrisStr.substring(i + 4, i + 4 + length);
    
    tags[tagId] = value;
    i += 4 + length;
  }

  // Update Tag 01 menjadi "12" (Point of Initiation Method: Dynamic QR)
  tags['01'] = '12';

  // Inject atau update Tag 54 (Transaction Amount)
  const amountStr = Math.round(Number(amount)).toString();
  tags['54'] = amountStr;

  // Rekonstruksi string QRIS (kecuali Tag 63 yang berisi CRC)
  let reconstructed = '';
  // Urutkan key agar konsisten, kecualikan tag 63
  const sortedKeys = Object.keys(tags).filter(k => k !== '63').sort();
  
  for (const key of sortedKeys) {
    const val = tags[key];
    const lenStr = val.length.toString().padStart(2, '0');
    reconstructed += key + lenStr + val;
  }

  // Tambahkan tag 63 dengan panjang 04 di akhir
  reconstructed += '6304';

  // Hitung ulang CRC-16
  const crc = calculateCRC16(reconstructed);

  // Return QRIS dinamis lengkap
  return reconstructed + crc;
}
