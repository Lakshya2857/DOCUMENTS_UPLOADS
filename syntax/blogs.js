const mongoose = require('mongoose');

const Format = new mongoose.Schema({
    name: String,
    position: String, 

    documents: [{
        title: String,
        url: String,
        container: String
    }]
});

const Module = mongoose.model("Module", Format);
module.exports = Module;