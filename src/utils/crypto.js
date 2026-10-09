import crypto from 'node:crypto';
import { config } from '../config/index.js';

export function hashSdrToken(rawToken) {
  return crypto.createHmac('sha256', config.SDR_LINK_PEPPER).update(rawToken).digest('hex');
}

export function createSdrToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function safeEqualHex(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
