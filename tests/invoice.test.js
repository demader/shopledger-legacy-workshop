// Characterization tests for lib/invoice.js (Ticket #1: invoice total and GST breakdown
// do not match what the customer was billed). They pin what the code does TODAY.
// Tests named "CURRENT BEHAVIOUR" record behaviour that looks wrong.
// In-memory fixtures only: never data/db.json.

var test = require('node:test');
var assert = require('node:assert/strict');

var invoice = require('../lib/invoice');
var reports = require('../lib/reports');
var fx = require('./fixtures');

function figures(id) {
  return invoice.computeInvoiceFigures(fx.order(id));
}

test('order #1008 (all 18% items, no coupon): invoice matches the billed ledger', function () {
  var f = figures(1008);
  assert.equal(f.subtotal, 500);
  assert.equal(f.discount, 0);
  assert.equal(f.tax, 90);
  assert.equal(f.cgst, 45);
  assert.equal(f.sgst, 45);
  assert.equal(f.total, 590);
});

test('invoice rows carry name, sku, hsn, qty, price and gross line value', function () {
  var rows = figures(1008).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { name: rows[0].name, sku: rows[0].sku, hsn: rows[0].hsn, qty: rows[0].qty, price: rows[0].price, line: rows[0].line },
    { name: 'Assam CTC Masala Chai 250g', sku: 'BEV-001', hsn: '0902', qty: 1, price: 140, line: 140 }
  );
  assert.equal(rows[1].line, 360);
});

// Updated after the Ticket #1 fix: these pinned the old (wrong) invoice figures.
test('order #1001 (no coupon) taxes chai at 18% and 0713 dal at its 5% slab', function () {
  var f = figures(1001);
  assert.deepEqual(f.rows.map(function (r) { return r.gstPercent; }), [18, 5]);
  assert.equal(f.tax, 66.9);       // was 109.80 before the fix
  assert.equal(f.total, 676.9);    // was 719.80 before the fix
});

test('order #1007 (no coupon) taxes ghee at 12% and sunflower oil at 5%', function () {
  var f = figures(1007);
  assert.deepEqual(f.rows.map(function (r) { return r.gstPercent; }), [12, 5]);
  assert.equal(f.tax, 127);        // was 230.40 before the fix
  assert.equal(f.total, 1407);     // was 1,510.40 before the fix
});

test('order #1002 (SAVE10) applies 10% to the pre-tax subtotal, then 5% GST', function () {
  var f = figures(1002);
  assert.equal(f.subtotal, 1020);
  assert.equal(f.discount, 102);   // was 120.36 before the fix
  assert.equal(f.tax, 45.9);       // was 183.60 before the fix
  assert.equal(f.total, 963.9);    // was 1,083.24 before the fix
});

test('order #1004 (SAVE10 on 2,240) caps the discount at 150', function () {
  var f = figures(1004);
  assert.equal(f.discount, 150);   // was 264.32 before the fix
  assert.equal(f.tax, 104.5);      // was 403.20 before the fix
  assert.equal(f.total, 2194.5);   // was 2,378.88 before the fix
});

test('order #1003 (FLAT50) taxes the post-discount value at 12% / 18%', function () {
  var f = figures(1003);
  assert.equal(f.discount, 50);
  assert.equal(f.tax, 49.35);      // was 72.00 before the fix
  assert.equal(f.total, 399.35);   // was 422.00 before the fix
});

test('an explicit gstRate on a line item takes precedence over the HSN slab', function () {
  var o = fx.order(1001);
  o.items[1].gstRate = 5;
  var f = invoice.computeInvoiceFigures(o);
  assert.deepEqual(f.rows.map(function (r) { return r.gstPercent; }), [18, 5]);
});

test('render(): matching order shows no reconciliation notice', function () {
  var html = invoice.render(fx.order(1008));
  assert.match(html, /INV-1008/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹590\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('render(): an order whose stored total differs from the invoice still shows the notice', function () {
  var o = fx.order(1002);
  o.total = 1000; // tampered ledger figure
  var html = invoice.render(o);
  assert.match(html, /Invoice Total<\/td><td class="r">₹963\.90/);
  assert.match(html, /Accountant Reconciliation Notice/);
});

test('GST reconciliation: all 8 seed orders match', function () {
  var recon = reports.getGstReconciliation(fx.db());
  assert.equal(recon.totalChecked, 8);
  assert.equal(recon.mismatchCount, 0);  // was 7 before the fix
  var matched = recon.rows.filter(function (r) { return r.matched; }).map(function (r) { return r.orderId; });
  assert.deepEqual(matched, [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008]);
});

// ---------------------------------------------------------------------------
// Ticket #1 — correct behaviour. The invoice must show exactly what checkout
// billed (lib/pricing.js): HSN GST slab per line, coupon on the pre-tax
// subtotal with minOrder and maxDiscount rules, GST on the post-discount value.
// ---------------------------------------------------------------------------

test('TICKET #1: every seed order invoice equals the billed ledger figures', function () {
  fx.orders().forEach(function (o) {
    var f = invoice.computeInvoiceFigures(o);
    assert.deepEqual(
      { id: o.id, subtotal: f.subtotal, discount: f.discount, tax: f.tax, total: f.total },
      { id: o.id, subtotal: o.subtotal, discount: o.discount, tax: o.tax, total: o.total }
    );
  });
});

test('TICKET #1: order #1002 (SAVE10) invoice is 963.90 with 45.90 GST', function () {
  var f = figures(1002);
  assert.equal(f.discount, 102);
  assert.equal(f.tax, 45.9);
  assert.equal(f.cgst, 22.95);
  assert.equal(f.sgst, 22.95);
  assert.equal(f.total, 963.9);
  assert.deepEqual(f.rows.map(function (r) { return [r.gstPercent, r.lineTax]; }), [[5, 28.8], [5, 17.1]]);
});

test('TICKET #1: order #1004 (SAVE10 on 2,240) respects the 150 discount cap', function () {
  var f = figures(1004);
  assert.equal(f.discount, 150);
  assert.equal(f.tax, 104.5);
  assert.equal(f.total, 2194.5);
});

test('TICKET #1: non-coupon orders use the HSN slab (5% / 12%), not 18%', function () {
  assert.deepEqual(figures(1001).rows.map(function (r) { return r.gstPercent; }), [18, 5]);
  assert.deepEqual(figures(1007).rows.map(function (r) { return r.gstPercent; }), [12, 5]);
  assert.equal(figures(1001).total, 676.9);
  assert.equal(figures(1007).total, 1407);
});

test('TICKET #1: render() of order #1002 shows 963.90 and no mismatch notice', function () {
  var html = invoice.render(fx.order(1002));
  assert.match(html, /Invoice Total<\/td><td class="r">₹963\.90/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('TICKET #1: GST reconciliation reports 0 mismatches for the seed orders', function () {
  var recon = reports.getGstReconciliation(fx.db());
  assert.equal(recon.mismatchCount, 0);
  assert.equal(recon.totalDelta, 0);
});
