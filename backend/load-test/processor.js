'use strict';

const fs = require('fs');
const path = require('path');

const USER_COUNT = 2500;
const BOOKING_PROBABILITY = 0.2;
const LOAD_TEST_PASSWORD = 'LoadTest123!';
const BASE_URL = process.env.LOAD_TEST_BASE_URL || 'http://localhost:3000';

function loadSeedOutput() {
  const seedPath = path.join(__dirname, 'seed-output.json');
  return JSON.parse(fs.readFileSync(seedPath, 'utf8'));
}

async function loginBeforeScenario(context, ee, next) {
  const seedOutput = loadSeedOutput();
  context.vars.screeningId = seedOutput.screeningId;
  context.vars.hotSeatId = seedOutput.hotSeatId;
  context.vars.willBook = Math.random() < BOOKING_PROBABILITY;

  const userIndex = Math.floor(Math.random() * USER_COUNT);
  const email = `loadtest${userIndex}@test.local`;

  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: LOAD_TEST_PASSWORD }),
  });

  if (!res.ok) {
    return next(new Error(`load-test login failed for ${email}: ${res.status}`));
  }

  const setCookies = res.headers.getSetCookie();
  context.vars.authCookie = setCookies.map((c) => c.split(';')[0]).join('; ');

  return next();
}

function pickAvailableSeat(requestParams, response, context, ee, next) {
  const seats = JSON.parse(response.body);
  const available = seats.filter((s) => s.status === 'AVAILABLE');
  if (available.length > 0) {
    const pick = available[Math.floor(Math.random() * available.length)];
    context.vars.pickedSeatId = pick.seatId;
  }
  return next();
}

// Round-robins each VU across the 20 hot screenings so every group gets ~100 VUs.
let hotScreeningCounter = 0;
function pickHotScreeningBeforeScenario(context, ee, next) {
  const seedOutput = loadSeedOutput();
  const group = seedOutput.hotScreenings[hotScreeningCounter % seedOutput.hotScreenings.length];
  hotScreeningCounter += 1;
  context.vars.screeningId = group.screeningId;
  context.vars.hotSeatId = group.hotSeatId;
  return next();
}

const contentionLogPath = path.join(__dirname, 'multi-contention-results.ndjson');
function logContentionResult(requestParams, response, context, ee, next) {
  const line = JSON.stringify({
    screeningId: context.vars.screeningId,
    statusCode: response.statusCode,
  });
  fs.appendFileSync(contentionLogPath, line + '\n');
  return next();
}

function captureReservationId(requestParams, response, context, ee, next) {
  const body = JSON.parse(response.body);
  context.vars.reservationId = body.reservationId;
  return next();
}

module.exports = {
  loginBeforeScenario,
  pickAvailableSeat,
  pickHotScreeningBeforeScenario,
  logContentionResult,
  captureReservationId,
};

if (require.main === module) {
  // ponytail: smallest runnable check for the branching logic here — this file
  // isn't application code under src/, so it's exempt from the Jest convention,
  // but the filtering/picking logic still deserves one assert-based self-check.
  const assert = require('assert');

  const mixed = [
    { seatId: 1, row: 'A', number: '1', status: 'BOOKED' },
    { seatId: 2, row: 'A', number: '2', status: 'AVAILABLE' },
  ];
  const ctx1 = { vars: {} };
  pickAvailableSeat(null, { body: JSON.stringify(mixed) }, ctx1, null, () => {});
  assert.strictEqual(ctx1.vars.pickedSeatId, 2, 'picks the only AVAILABLE seat');

  const allBooked = [{ seatId: 1, row: 'A', number: '1', status: 'BOOKED' }];
  const ctx2 = { vars: {} };
  pickAvailableSeat(null, { body: JSON.stringify(allBooked) }, ctx2, null, () => {});
  assert.strictEqual(
    ctx2.vars.pickedSeatId,
    undefined,
    'leaves pickedSeatId unset when nothing is available',
  );

  console.log('processor.js self-check passed');
}