# Browser playback dependencies

The files in this directory are pinned browser distributions. They are served
locally; playback does not download scripts from a third-party CDN.

- **mpegts.js 1.8.2** by magicxqq and contributors, Apache-2.0.
  Source: https://github.com/xqq/mpegts.js
  npm: https://www.npmjs.com/package/mpegts.js/v/1.8.2
  License: `mpegts-LICENSE.txt`; bundled dependency notices:
  `mpegts.js.LICENSE.txt` (retained from the upstream distribution).
  npm tarball SHA-512:
  `cZYMa5muASH55wrS6JK5IGkUqnCA96c0f+WdnW91jIK9s/N6NzjmTQDJNYg9A5u/G2Q5nj2b3w1Zwzze/9guxA==`.
  Local modification: optional AVC sample callback for pairing interlaced fields.
  The encoded video data is not recoded. The application callback is readable in
  `avc-fields.js`; `scripts/patch-mpegts.js` reproduces the one-site patch and
  checks the SHA-256 of the original distribution before modifying it.
- **mpg123-decoder 1.0.3** by Ethan Halsall, MIT (as declared by the npm package).
  Source and build instructions:
  https://github.com/eshaz/wasm-audio-decoders/tree/main/src/mpg123-decoder
  npm: https://www.npmjs.com/package/mpg123-decoder/v/1.0.3
  The upstream copyright notice is retained in the distributed file.
  The embedded WebAssembly uses mpg123; upstream source and licensing information:
  https://www.mpg123.de/ and https://www.mpg123.de/cgi-bin/scm/mpg123/trunk/COPYING?view=markup
  npm tarball SHA-512:
  `+fjxnWigodWJm3+4pndi+KUg9TBojgn31DPk85zEsim7C6s0X5Ztc/hQYdytXkwuGXH+aB0/aEkG40Emukv6oQ==`.
