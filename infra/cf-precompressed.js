// CloudFront Function (cloudfront-js-2.0, viewer request) for bedrock-compare.awskr.net.
// Serves the pre-compressed copy of the page that matches the visitor's
// Accept-Encoding. The .br/.gz objects carry their own Content-Encoding header,
// so CloudFront does not compress them again. Anything else passes through.
function handler(event) {
  var req = event.request;
  if (req.uri === "/" || req.uri === "/index.html") {
    var h = req.headers["accept-encoding"];
    var ae = h ? h.value : "";
    if (/(^|[\s,])br($|[\s,;])/.test(ae)) req.uri = "/index.html.br";
    else if (/(^|[\s,])gzip($|[\s,;])/.test(ae)) req.uri = "/index.html.gz";
    else req.uri = "/index.html";
  }
  return req;
}
