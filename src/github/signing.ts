import { createSign, createVerify } from "node:crypto";
import { readFileSync } from "node:fs";

export class AssetSigner {
  private privateKey: string;

  constructor(privateKeyPath: string) {
    this.privateKey = readFileSync(privateKeyPath, "utf-8");
  }

  sign(data: Buffer): string {
    const sign = createSign("RSA-SHA256");
    sign.update(data);
    return sign.sign(this.privateKey, "base64");
  }

  static verify(data: Buffer, signature: string, publicKey: string): boolean {
    try {
      const verify = createVerify("RSA-SHA256");
      verify.update(data);
      return verify.verify(publicKey, signature, "base64");
    } catch {
      console.warn("Signature verification failed");
      return false;
    }
  }
}
