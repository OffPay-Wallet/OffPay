import {
  digestBytes,
  digestBytesAsync,
  digestHex,
  hmacSha256HexSafe,
} from '@/lib/crypto/safe-hash';

describe('safe hash adapter', () => {
  it('computes SHA-256 hex without optional native crypto dependencies', () => {
    expect(digestHex('SHA-256', 'offpay')).toBe(
      '5efbf6162e3c2fcc01d03398b1601508cb8ceffd655a300f4eec5289b120e0b3',
    );
  });

  it('computes SHA-512 bytes without optional native crypto dependencies', () => {
    expect(Buffer.from(digestBytes('SHA-512', 'offpay')).toString('hex')).toBe(
      'e428088e30a1382ec364c2c09718cc2198b587d8afe200262118ceb09040b47ec0c1cd4b027303e6158f184799730d8500d9bde4a9352f3587be5da67a74bd80',
    );
  });

  it('computes async SHA-512 bytes through expo-crypto or noble fallback', async () => {
    await expect(digestBytesAsync('SHA-512', 'offpay')).resolves.toEqual(
      digestBytes('SHA-512', 'offpay'),
    );
  });

  it('computes HMAC-SHA256 without exposing signing material', () => {
    expect(hmacSha256HexSafe('secret', 'message')).toBe(
      '8b5f48702995c1598c573db1e21866a9b825d4a794d169d7060a03605796360b',
    );
  });
});
