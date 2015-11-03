// jspredict.js makes `jspredict` global on the window (or global) object, while Meteor expects a file-scoped global variable
jspredict = this.jspredict;
try {
    delete this.jspredict;
} catch (e) {
}
