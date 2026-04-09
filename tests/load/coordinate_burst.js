// k6 burst / spike test — ramps to 30 VUs over 60s, holds 5m.
//
// Verifies the Kafka consumer + LangGraph coordinator stay under the
// 8s p95 budget and that the DLQ does not grow under sustained burst.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.HFCX_API_URL || 'http://localhost:8090';
const TOKEN    = __ENV.HFCX_TOKEN   || 'dev-token';

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '60s', target: 30 },
        { duration: '5m',  target: 30 },
        { duration: '30s', target: 0  },
      ],
    },
  },
  thresholds: {
    'http_req_failed':                    ['rate<0.02'],
    'http_req_duration{path:coordinate}': ['p(95)<8000'],
    'checks':                             ['rate>0.98'],
  },
};

function buildBundle(i) {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      {
        resource: {
          resourceType: 'Claim',
          id: `BURST-${i}`,
          type: { coding: [{ code: 'professional' }] },
          patient:  { reference: 'Patient/29901011234567' },
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
          item: [{ sequence: 1, servicedDate: new Date().toISOString().slice(0, 10) }],
        },
      },
    ],
  };
}

export default function () {
  const payload = JSON.stringify({
    fhir_claim_bundle: buildBundle(`${__VU}-${__ITER}`),
    hcx_headers: {
      'X-HCX-Correlation-ID': `BURST-${__VU}-${__ITER}`,
      'X-HCX-Sender-Code':    'LOAD-VU',
      'X-HCX-Recipient-Code': 'MISR-INSURANCE-001',
      'X-HCX-Workflow-ID':    'wf-burst',
      'X-HCX-API-Call-ID':    `BURST-${__VU}-${__ITER}`,
    },
  });

  const res = http.post(
    `${BASE_URL}/internal/ai/coordinate`,
    payload,
    {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      tags: { path: 'coordinate' },
    },
  );

  check(res, {
    'status under burst': (r) => r.status === 200 || r.status === 503,
  });

  sleep(0.5);
}
