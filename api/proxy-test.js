export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    message: 'Shopify app proxy is working',
    query: req.query
  });
}
