# Local CCA trust store

Contains the two current Root Certifying Authority of India certificates listed by CCA, downloaded from the official certificate links on <https://cca.gov.in/root_certificate.html> on 2026-10-26. Both are self-signed PEM certificates and are used as local trust anchors only; certificate fetching is disabled during validation.

| Certificate | Validity on CCA page | SHA-256 fingerprint |
| --- | --- | --- |
| CCA India 2022 | 2022-02-02 to 2042-02-02 | `9A3FD3176798E842DDCB12C262F11CFACCA70A8B84C6EA6FDA30842A95A94CD8` |
| CCA India 2022 SPL | 2022-09-20 to 2042-09-20 | `B724689B79B2EF9421EF8F5CC733EB093851B170EE715177005A09F226D8C91A` |

Use only synthetic PDFs for this demo. A valid chain result does not replace human review or establish revocation status when no applicable CRL/OCSP data is available.
