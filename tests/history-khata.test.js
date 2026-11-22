// Ticket #3: Order History sorting & date filter are broken, and Khata settlements corrupt balances.
// Characterization tests for lib/orders.js list(), lib/dates.js and lib/ledger.js recordSettlement().
// In-memory fixtures only: never data/db.json.

var test = require('node:test');
var assert = require('node:assert/strict');

var orders = require('../lib/orders');
var ledger = require('../lib/ledger');
var dates = require('../lib/dates');

var SEED = [
  [1001, '28/12/2021', 'Meera Joshi', 'completed', ''],
  [1002, '05/01/2022', 'Anil Kulkarni', 'completed', 'SAVE10'],
  [1003, '14/01/2022', 'Walk-in', 'completed', 'FLAT50'],
  [1004, '30/01/2022', 'Kalyani Foods (Wholesale)', 'completed', 'SAVE10'],
  [1005, '02/02/2022', 'Priya Nair', 'completed', 'FLAT50'],
  [1006, '18/02/2022', 'Meera Joshi', 'completed', 'WELCOME'],
  [1007, '04/03/2022', 'Suresh Deshmukh', 'pending', ''],
  [1008, '15/03/2022', 'Walk-in', 'completed', '']
];

function db() {
  return {
    orders: SEED.map(function (r) {
      return { id: r[0], date: r[1], customer: r[2], status: r[3], coupon: r[4], items: [] };
    }),
    customers: [
      { id: 1, name: 'Meera Joshi', creditLimit: 5000, openingBalance: 450, totalBilled: 1982.01, totalSettled: 1200, balance: 1232.01 }
    ],
    settlements: [],
    nextSettlementId: 505
  };
}

function ids(list) { return list.map(function (o) { return o.id; }); }

// --- Order History ---------------------------------------------------------

test('list() returns every order when no filters are given', function () {
  assert.equal(orders.list(db(), {}).length, 8);
});

test('list() filters by status and by search text', function () {
  assert.deepEqual(ids(orders.list(db(), { status: 'pending' })), [1007]);
  assert.deepEqual(ids(orders.list(db(), { search: 'save10' })).sort(), [1002, 1004]);
});

// Updated after the Ticket #3 fix: these pinned string-sorted dates and broken range filters.
test('list() sorts by calendar date, newest first (#1008 on top, #1001 last)', function () {
  assert.deepEqual(ids(orders.list(db(), {})), [1008, 1007, 1006, 1005, 1004, 1003, 1002, 1001]); // was 1004, 1001, 1006, ...
});

test('date range January 2022 (from the date picker) returns the 3 January orders', function () {
  assert.equal(orders.list(db(), { from: '2022-01-01', to: '2022-01-31' }).length, 3); // was 8
});

test('"from 2022-02-01" returns 4 orders and "to 2021-12-31" returns 1', function () {
  assert.equal(orders.list(db(), { from: '2022-02-01' }).length, 4); // was 8
  assert.equal(orders.list(db(), { to: '2021-12-31' }).length, 1);   // was 8
});

test('toSortKey() turns both date formats into a sortable YYYYMMDD key', function () {
  assert.equal(dates.toSortKey('28/12/2021'), '20211228');
  assert.equal(dates.toSortKey('2022-01-05'), '20220105');
  assert.equal(dates.toSortKey(''), '');
});

test('normalizeDateKey() converts YYYY-MM-DD to DD/MM/YYYY and leaves DD/MM/YYYY alone', function () {
  assert.equal(dates.normalizeDateKey('2022-01-31'), '31/01/2022');
  assert.equal(dates.normalizeDateKey('31/01/2022'), '31/01/2022');
  assert.equal(dates.normalizeDateKey(''), '');
});

test('getFiscalYear() uses an April start', function () {
  assert.equal(dates.getFiscalYear('15/03/2022'), 'FY21-22');
  assert.equal(dates.getFiscalYear('2022-04-01'), 'FY22-23');
});

// --- Khata settlements -----------------------------------------------------

test('recordSettlement() with a numeric amount updates totals and logs an entry', function () {
  var d = db();
  var r = ledger.recordSettlement(d, 1, 500, 'cash', 'Counter');
  assert.equal(r.ok, true);
  assert.equal(r.customer.totalSettled, 1700);
  assert.equal(r.customer.balance, 732.01);
  assert.equal(d.settlements[0].amount, 500);
  assert.equal(d.settlements[0].id, 505);
});

test('recordSettlement() rejects zero, negative and missing amounts, and unknown customers', function () {
  var err = { ok: false, error: 'Settlement amount must be greater than zero' };
  assert.deepEqual(ledger.recordSettlement(db(), 1, 0), err);
  assert.deepEqual(ledger.recordSettlement(db(), 1, '-5'), err);
  assert.deepEqual(ledger.recordSettlement(db(), 1, ''), err);
  assert.deepEqual(ledger.recordSettlement(db(), 99, 500), { ok: false, error: 'Customer not found' });
});

// Updated after the Ticket #3 fix: these pinned string concatenation of the amount.
test('a string amount "500" (as the UI sends it) is added as a number', function () {
  var r = ledger.recordSettlement(db(), 1, '500', 'upi', '');
  assert.equal(r.customer.totalSettled, 1700);  // was "1200500"
  assert.equal(r.customer.balance, 732.01);     // was -1198067.99
});

test('a non-numeric amount "abc" is rejected', function () {
  var r = ledger.recordSettlement(db(), 1, 'abc', 'upi', '');
  assert.equal(r.ok, false);                    // was accepted, Settled "1200abc"
});

// ---------------------------------------------------------------------------
// Ticket #3 — correct behaviour
// ---------------------------------------------------------------------------

test('TICKET #3: Order History lists newest first by calendar date', function () {
  assert.deepEqual(ids(orders.list(db(), {})), [1008, 1007, 1006, 1005, 1004, 1003, 1002, 1001]);
});

test('TICKET #3: orders on the same date keep newest (highest id) first', function () {
  var d = db();
  d.orders.push({ id: 1009, date: '15/03/2022', customer: 'Walk-in', status: 'completed', coupon: '', items: [] });
  assert.deepEqual(ids(orders.list(d, {})).slice(0, 2), [1009, 1008]);
});

test('TICKET #3: date range January 2022 returns only January orders (inclusive)', function () {
  assert.deepEqual(ids(orders.list(db(), { from: '2022-01-01', to: '2022-01-31' })), [1004, 1003, 1002]);
});

test('TICKET #3: open-ended from / to filters', function () {
  assert.deepEqual(ids(orders.list(db(), { from: '2022-03-01' })), [1008, 1007]);
  assert.deepEqual(ids(orders.list(db(), { to: '2021-12-31' })), [1001]);
});

test('TICKET #3: DD/MM/YYYY filter values work the same as the date picker format', function () {
  assert.deepEqual(ids(orders.list(db(), { from: '01/02/2022', to: '28/02/2022' })), [1006, 1005]);
});

test('TICKET #3: Meera Joshi settling "500" gives Settled 1,700 and Balance Due 732.01', function () {
  var d = db();
  var r = ledger.recordSettlement(d, 1, '500', 'upi', '');
  assert.equal(r.ok, true);
  assert.equal(r.customer.totalSettled, 1700);
  assert.equal(r.customer.balance, 732.01);
  assert.equal(ledger.listCustomers(d)[0].balance, 732.01);
  assert.equal(d.settlements[0].amount, 500);
});

test('TICKET #3: decimal string amounts are added as money', function () {
  var r = ledger.recordSettlement(db(), 1, '32.01', 'cash', '');
  assert.equal(r.customer.totalSettled, 1232.01);
  assert.equal(r.customer.balance, 1200);
});

test('TICKET #3: non-numeric amounts are rejected and change nothing', function () {
  var d = db();
  assert.deepEqual(ledger.recordSettlement(d, 1, 'abc'), { ok: false, error: 'Settlement amount must be greater than zero' });
  assert.equal(d.customers[0].totalSettled, 1200);
  assert.equal(d.settlements.length, 0);
});
