Package.describe({
  summary: "javascript port of predict open-source satellite tracking library",
  version: "1.1.1",
  name: "rosh93:jspredict",
  git: "https://github.com/nsat/jspredict"
});

Package.onUse(function(api) {
  api.use("momentjs:moment@2.24.0");
  api.addFiles('satellite.js', ['client', 'server'], {
    bare: true
  });
  api.addFiles([
    "jspredict.js",
    "export.js"
  ]);
  api.export("jspredict");
});
