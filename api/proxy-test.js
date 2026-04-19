export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  res.status(200).send('Shopify app proxy is working');
}