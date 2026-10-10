/**
 * File: Pricing.gs
 * VAT & FX normalisation so quotations with different terms can be compared fairly.
 *
 *   vat_term     net unit cost (what MGS really pays after VAT reclaim)   gross unit price (cash out)
 *   ex_vat       price                     (7% input VAT reclaimable)      price × (1 + vat)
 *   include_vat  price ÷ (1 + vat)                                         price
 *   no_vat       price                     (vendor not VAT registered)     price
 *   → both × fx_rate to THB.
 *
 * vat_rate is a snapshot stored on each quotation when it is first saved, so changing
 * the VAT rate in Settings never changes historical comparisons.
 *
 * Selling price (per unit, THB):
 *   landed cost   = net unit cost THB + clearance (ค่าเคลียร์ของ, THB per unit, entered per vendor)
 *   selling price = landed cost ÷ (1 − GP%)          GP% is a margin on the selling price
 *   profit        = selling price − landed cost
 * Vendors are ranked by landed cost, so a CIF import is compared fairly with a delivered local offer.
 */

function quoteCosts_(unitPrice, fxRate, vatTerm, vatRate, clearance) {
  const net = vatTerm === 'include_vat' ? unitPrice / (1 + vatRate) : unitPrice;
  const gross = vatTerm === 'ex_vat' ? unitPrice * (1 + vatRate) : unitPrice;
  return {
    net_unit_cost: round_(net, 6),
    net_unit_cost_thb: round_(net * fxRate, 6),
    gross_unit_price_thb: round_(gross * fxRate, 6),
    landed_unit_cost_thb: round_(net * fxRate + (clearance || 0), 6)
  };
}

/**
 * Landed-cost breakdown per unit (THB) → total import cost (stored as clearance_thb):
 *   CIF   = net unit cost THB + freight + insurance
 *   duty  = CIF × duty %
 *   total = freight + insurance + duty + import fees (อย. / กรมประมง) + cold storage + inland transport + other
 * bd: { freight, insurance, duty_pct, fees, cold, inland, other } — returns a copy with duty_thb + total_thb.
 */
const COST_PARTS_ = ['freight', 'insurance', 'fees', 'cold', 'inland', 'other'];
function costBreakdown_(netUnitCostThb, bd) {
  const out = {};
  COST_PARTS_.forEach(function (k) { out[k] = Number(bd[k]) || 0; });
  out.duty_pct = Number(bd.duty_pct) || 0;
  out.duty_thb = round_((netUnitCostThb + out.freight + out.insurance) * out.duty_pct / 100, 4);
  out.total_thb = round_(out.freight + out.insurance + out.duty_thb + out.fees + out.cold + out.inland + out.other, 4);
  return out;
}

function minGpPercent_() {
  const v = Number(setting_('min_gp_percent', 10));
  return isFinite(v) && v >= 0 && v < 100 ? v : 10;
}

function defaultGp_() {
  const v = Number(setting_('default_gp_percent', 15));
  return isFinite(v) && v >= 0 && v < 100 ? v : 15;
}

/** Selling price breakdown for one item from its winning quotation. */
function itemPricing_(it, winner) {
  const gp = it.gp_percent === null || it.gp_percent === undefined || it.gp_percent === '' ? defaultGp_() : Number(it.gp_percent);
  if (!winner) return { gp_percent: gp, gp_is_default: it.gp_percent === null || it.gp_percent === '' };
  const sell = round_(winner.landed_unit_cost_thb / (1 - gp / 100), 2);
  const out = {
    vendor_name: winner.vendor_name,
    product_cost_thb: round_(winner.net_unit_cost_thb, 2),
    clearance_thb: round_(winner.clearance_thb, 2),
    landed_cost_thb: round_(winner.landed_unit_cost_thb, 2),
    gp_percent: gp,
    gp_is_default: it.gp_percent === null || it.gp_percent === '',
    gp_below_min: gp < minGpPercent_(),
    min_gp_percent: minGpPercent_(),
    profit_thb: round_(sell - round_(winner.landed_unit_cost_thb, 2), 2),   // table rows add up: landed + profit = selling
    sell_price_thb: sell,
    target_price: it.target_price || 0,
    target_diff_pct: it.target_price ? round_((sell - it.target_price) / it.target_price * 100, 1) : null
  };
  return out;
}

/**
 * Sales-side view of the price: selling price per unit + the offer terms Sales needs to quote the customer.
 * Deliberately leaves out vendor name, vendor price, currency/FX, VAT, clearance, landed cost, GP and profit.
 */
function salesPricing_(it, winner) {
  if (!winner) return null;
  const p = itemPricing_(it, winner);
  return {
    sell_price_thb: p.sell_price_thb,
    target_price: p.target_price,
    target_diff_pct: p.target_diff_pct,
    brand: winner.brand || '', origin_country: winner.origin_country || '', packing: winner.packing || '',
    shelf_life: winner.shelf_life || '', moq: winner.moq, lead_time_days: winner.lead_time_days,
    valid_until: winner.valid_until || ''
  };
}

function normQuote_(r) {
  return {
    quote_id: String(r.quote_id),
    item_id: String(r.item_id),
    ticket_id: String(r.ticket_id),
    vendor_id: String(r.vendor_id || ''),
    vendor_name: String(r.vendor_name || ''),
    unit_price: Number(r.unit_price),
    currency: String(r.currency || 'THB'),
    fx_rate: Number(r.fx_rate || 1),
    vat_term: String(r.vat_term),
    vat_rate: Number(r.vat_rate),
    moq: r.moq === '' ? null : Number(r.moq),
    lead_time_days: r.lead_time_days === '' ? null : Number(r.lead_time_days),
    payment_term: String(r.payment_term || ''),
    valid_until: r.valid_until ? fmtDate_(r.valid_until) : '',
    remark: String(r.remark || ''),
    attachment_file_id: String(r.attachment_file_id || ''),
    is_selected: toBool_(r.is_selected),
    selection_reason: String(r.selection_reason || ''),
    net_unit_cost: Number(r.net_unit_cost),
    net_unit_cost_thb: Number(r.net_unit_cost_thb),
    gross_unit_price_thb: Number(r.gross_unit_price_thb),
    brand: String(r.brand || ''),
    origin_country: String(r.origin_country || ''),
    packing: String(r.packing || ''),
    incoterm: String(r.incoterm || ''),
    shelf_life: String(r.shelf_life || ''),
    clearance_thb: r.clearance_thb === '' || r.clearance_thb === undefined ? 0 : Number(r.clearance_thb),
    cost_breakdown: r.cost_breakdown_json ? parseJson_(r.cost_breakdown_json, null) : null,
    cost_breakdown_json: String(r.cost_breakdown_json || ''),
    fx_date: r.fx_date ? fmtDate_(r.fx_date) : '',
    landed_unit_cost_thb: r.landed_unit_cost_thb === '' || r.landed_unit_cost_thb === undefined
      ? Number(r.net_unit_cost_thb) + (r.clearance_thb === '' || r.clearance_thb === undefined ? 0 : Number(r.clearance_thb))
      : Number(r.landed_unit_cost_thb),
    created_by: String(r.created_by || ''),
    created_at: isoOrBlank_(r.created_at),
    updated_at: isoOrBlank_(r.updated_at)
  };
}

/** Active (not soft-deleted) quotations of one item. */
function activeQuotesOfItem_(itemId) {
  return findAll_(TAB.QUOTATIONS, 'item_id', itemId)
    .filter(function (r) { return !toBool_(r.is_deleted); })
    .map(normQuote_);
}

/**
 * Comparison view for one item: adds totals, rank and the "cheapest" flag
 * (ties are all cheapest). Equivalent of a SQL view, computed on the server.
 */
function compareQuotes_(qty, quotes) {
  const EPS = 0.000001;
  const min = quotes.reduce(function (m, q) { return Math.min(m, q.landed_unit_cost_thb); }, Infinity);
  const sorted = quotes.slice().sort(function (a, b) { return a.landed_unit_cost_thb - b.landed_unit_cost_thb; });
  return quotes.map(function (q) {
    let rank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].landed_unit_cost_thb < q.landed_unit_cost_thb - EPS) rank++;
    }
    const out = Object.assign({}, q);
    out.total_cost_thb = round_(q.net_unit_cost_thb * qty, 2);
    out.total_gross_thb = round_(q.gross_unit_price_thb * qty, 2);
    out.cost_rank = rank;
    out.is_cheapest = Math.abs(q.landed_unit_cost_thb - min) < EPS;
    return out;
  });
}
