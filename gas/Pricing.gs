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
 */

function quoteCosts_(unitPrice, fxRate, vatTerm, vatRate) {
  const net = vatTerm === 'include_vat' ? unitPrice / (1 + vatRate) : unitPrice;
  const gross = vatTerm === 'ex_vat' ? unitPrice * (1 + vatRate) : unitPrice;
  return {
    net_unit_cost: round_(net, 6),
    net_unit_cost_thb: round_(net * fxRate, 6),
    gross_unit_price_thb: round_(gross * fxRate, 6)
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
  const min = quotes.reduce(function (m, q) { return Math.min(m, q.net_unit_cost_thb); }, Infinity);
  const sorted = quotes.slice().sort(function (a, b) { return a.net_unit_cost_thb - b.net_unit_cost_thb; });
  return quotes.map(function (q) {
    let rank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].net_unit_cost_thb < q.net_unit_cost_thb - EPS) rank++;
    }
    const out = Object.assign({}, q);
    out.total_cost_thb = round_(q.net_unit_cost_thb * qty, 2);
    out.total_gross_thb = round_(q.gross_unit_price_thb * qty, 2);
    out.cost_rank = rank;
    out.is_cheapest = Math.abs(q.net_unit_cost_thb - min) < EPS;
    return out;
  });
}
