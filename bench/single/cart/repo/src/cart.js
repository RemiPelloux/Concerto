/** Each item: { sku, price (cents), qty }. Shipping is 499 cents under 5000, else free. */
export function total(items) {
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const shipping = subtotal >= 5000 ? 0 : 499;
  return subtotal + shipping;
}
