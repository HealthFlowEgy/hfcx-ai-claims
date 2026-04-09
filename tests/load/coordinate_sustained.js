// k6 sustained-throughput test for POST /internal/ai/coordinate.
//
// SRS §9:   100K claims/day sustained, p95 < 8s E2E.
// 100K / day ≈ 69.4 claims/minute ≈ 1.16 claims/second.
// We aim for 3 VUs @ 2.5s iteration = 1.2 claims/s which is just above
// the daily target, giving headroom for variance.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.HFCX_API_URL || 'http://localhost:8090';
const TOKEN    = __ENV.HFCX_TOKEN   || 'dev-token';

const latency = new Trend('hfcx_ai_coordinate_latency_ms');
const errors  = new Counter('hfcx_ai_coordinate_errors');

export const options = {
  scenarios: {
    sustained: {
      executor: 'constant-vus',
      vus: 3,
      duration: '5m',
    },
  },
  thresholds: {
    'http_req_failed':                    ['rate<0.01'],          // <1%
    'http_req_duration{path:coordinate}': ['p(95)<8000'],         // SRS NFR-001
    'checks':                             ['rate>0.99'],
  },
};

function egyptianNID() {
  // 14 digits with a realistic birth-date prefix (199001011234567-ish).
  const year  = 1960 + Math.floor(Math.random() * 50);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day   = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  const seq   = String(Math.floor(Math.random() * 1000000)).padStart(7, '0');
  return `2${year.toString().slice(2)}${month}${day}${seq.slice(0, 6)}`.slice(0, 14);
}

function buildFhirBundle(claimId) {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      {
        resource: {
          resourceType: 'Claim',
          id: claimId,
          type: { coding: [{ code: 'professional' }] },
          patient:  { reference: `Patient/${egyptianNID()}` },
          provider: { reference: 'Organization/HCP-EG-CAIRO-001' },
          insurance: [{ coverage: { reference: 'Coverage/MISR-INSURANCE-001' } }],
          created: new Date().toISOString(),
          diagnosis: [
            {
              sequence: 1,
              diagnosisCodeableConcept: {
                coding: [{ code: 'J06.9', system: 'http://hl7.org/fhir/sid/icd-10' }],
              },
            },
          ],
          total: { value: 850, currency: 'EGP' },
          item: [
            {
              sequence: 1,
              servicedDate: new Date().toISOString().slice(0, 10),
              productOrService: { coding: [{ code: '99213' }] },
            },
          ],
        },
      },
    ],
  };
}

export default function () {
  const claimId = `LOAD-${__VU}-${__ITER}`;
  const payload = JSON.stringify({
    fhir_claim_bundle: buildFhirBundle(claimId),
    hcx_headers: {
      'X-HCX-Correlation-ID': claimId,
      'X-HCX-Sender-Code':    'LOAD-VU',
      'X-HCX-Recipient-Code': 'MISR-INSURANCE-001',
      'X-HCX-Workflow-ID':    'wf-load',
      'X-HCX-API-Call-ID':    claimId,
    },
  });

  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${TOKEN}`,
  };

  const res = http.post(
    `${BASE_URL}/internal/ai/coordinate`,
    payload,
    { headers, tags: { path: 'coordinate' } },
  );

  latency.add(res.timings.duration);
  if (res.status !== 200) errors.add(1);

  check(res, {
    'status is 200 or 503': (r) => r.status === 200 || r.status === 503,
    'has correlation_id':   (r) => r.status !== 200 || r.json('correlation_id') !== '',
  });

  sleep(2.5);
}
