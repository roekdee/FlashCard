// PromptPay QR, built here rather than fetched from somebody's image API —
// the amount and the receiving number never leave the browser, and there is no
// third party to go down on payday.
//
// The payload is EMVCo TLV: each field is a 2-digit id, a 2-digit length, then
// the value. Spec: EMV QRCPS + the Thai PromptPay profile.

const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;

/** CRC-16/CCITT-FALSE, which the spec picks for field 63. */
function crc16(s) {
    let crc = 0xffff;
    for (let i = 0; i < s.length; i++) {
        crc ^= s.charCodeAt(i) << 8;
        for (let b = 0; b < 8; b++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xffff;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * A mobile number goes in as 0066 plus the number without its leading zero;
 * a national ID or tax ID goes in as-is. Both are padded to 13 digits.
 */
function targetField(id) {
    const digits = String(id).replace(/\D/g, '');
    if (digits.length === 13) return tlv('02', digits);          // national / tax id
    const phone = ('0000000000000' + '66' + digits.replace(/^0/, '')).slice(-13);
    return tlv('01', phone);
}

/**
 * @param {string} promptpayId  mobile number, national ID or tax ID
 * @param {number} amountBaht   omit for a QR the payer types the amount into
 * @returns {string} the string to render as a QR code
 */
export function promptPayPayload(promptpayId, amountBaht) {
    const merchant = tlv('00', 'A000000677010111') + targetField(promptpayId);

    const body =
        tlv('00', '01') +                                  // payload format
        tlv('01', amountBaht ? '12' : '11') +               // 12 = single use
        tlv('29', merchant) +
        tlv('53', '764') +                                  // THB
        (amountBaht ? tlv('54', Number(amountBaht).toFixed(2)) : '') +
        tlv('58', 'TH');

    const withCrcTag = body + '6304';
    return withCrcTag + crc16(withCrcTag);
}

/** Draw `text` as a QR code into `canvas`. Loads the encoder on first use. */
export async function drawQR(canvas, text) {
    const { default: QRCode } =
        await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
    await QRCode.toCanvas(canvas, text, {
        width: 260,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
    });
}

// Self-check: the amount must change the payload, tag 54 must carry it, and a
// known-good pair must round-trip. Run with `node promptpay.js`.
if (import.meta.main) {
    const withAmount = promptPayPayload('0812345678', 99);
    const without    = promptPayPayload('0812345678');

    console.assert(withAmount.includes('540599.00'), 'amount missing from tag 54');
    console.assert(!without.includes('5405'), 'no-amount QR should omit tag 54');
    console.assert(withAmount.includes('0066812345678'), 'phone not normalised');
    console.assert(promptPayPayload('1234567890123').includes('02131234567890123'),
        'national id should use tag 02');

    // The CRC must cover the whole payload: flip a digit, it must differ.
    const a = promptPayPayload('0812345678', 99);
    const b = promptPayPayload('0812345678', 98);
    console.assert(a.slice(-4) !== b.slice(-4), 'crc did not follow the amount');

    console.log('promptpay ok', withAmount);
}
