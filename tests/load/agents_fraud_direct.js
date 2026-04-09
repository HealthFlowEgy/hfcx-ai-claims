// k6 direct-fraud-scoring test — isolates the fraud agent from the
// full coordinator graph. Useful to distinguish fraud-detection
// regressions from end-to-end latency drift.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.HFCX_API_URL || 'http://localhost:8090';
const TOKEN    = __ENV.HFCX_TOKEN   || 'dev-token';

export const options = {
  vus: 10,
  duration: '2m',
  thresholds: {
    'http_req_failed':                          ['rate<0.01'],
    'http_req_duration{path:fraud_direct}':     ['p(95)<2000'],
    'checks':                                   ['rate>0.99'],
  },
};

export default function () {
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    claim_id:        `FRAUD-${__VU}-${__ITER}`,
    provider_id:     'HCP-EG-CAIRO-001',
    patient_id:      '29901011234567',
    total_amount:    1500.0 + Math.random() * 10000,
    diagnosis_codes: ['J06.9', 'Z00.00'],
    procedure_codes: ['99213'],
    claim_date:      now,
    service_date:    now,
    claim_type:      'outpatient',
  });

  const res = http.post(
    `${BASE_URL}/internal/ai/agents/fraud/score`,
    payload,
    {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      tags: { path: 'fraud_direct' },
    },
  );

  check(res, {
    'status is 200':       (r) => r.status === 200,
    'has fraud_score':     (r) => r.status !== 200 || r.json('fraud_score') !== undefined,
    'has risk_level':      (r) => r.status !== 200 || r.json('risk_level') !== undefined,
  });

  sleep(1);
}
