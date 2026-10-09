import crypto
  from 'node:crypto';

import {
  config
} from '../config/index.js';


/*
 * =========================================================
 * ADMIN DASHBOARD AUTHENTICATION
 * =========================================================
 *
 * The browser sends:
 *
 * X-Admin-Key: ...
 *
 * This protects upload/delete/sync/list endpoints.
 */
export function requireAdminKey(
  req,
  res,
  next
) {
  const supplied =
    String(
      req.get(
        'x-admin-key'
      ) ||
      ''
    );


  const expected =
    String(
      config.ADMIN_DASHBOARD_KEY ||
      ''
    );


  if (
    !supplied ||
    !expected
  ) {
    return res
      .status(401)
      .json({
        success:
          false,

        code:
          'ADMIN_AUTH_REQUIRED',

        message:
          'Administrator authentication is required.'
      });
  }


  /*
   * timingSafeEqual requires equal-length Buffers.
   */
  const suppliedBuffer =
    Buffer.from(
      supplied
    );

  const expectedBuffer =
    Buffer.from(
      expected
    );


  if (
    suppliedBuffer.length !==
    expectedBuffer.length
  ) {
    return res
      .status(401)
      .json({
        success:
          false,

        code:
          'INVALID_ADMIN_KEY',

        message:
          'The administrator key is incorrect.'
      });
  }


  const valid =
    crypto.timingSafeEqual(
      suppliedBuffer,
      expectedBuffer
    );


  if (!valid) {
    return res
      .status(401)
      .json({
        success:
          false,

        code:
          'INVALID_ADMIN_KEY',

        message:
          'The administrator key is incorrect.'
      });
  }


  next();
}