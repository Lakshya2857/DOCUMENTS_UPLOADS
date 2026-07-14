require('dotenv').config();
const express = require("express");
const app = express();
const multer = require('multer');
const mongoose = require("mongoose");
const morgan = require("morgan");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});
const streamifier = require('streamifier');
const fs = require('fs');     
const path = require('path'); 

// Local storage setup removed for Vercel compatibility

const data = require('./syntax/blogs.js'); 

let isConnected = false;
const connectDB = async () => {
    if (isConnected) return;
    try {
        const db = await mongoose.connect(process.env.MONGODB_URI);
        isConnected = db.connections[0].readyState;
        console.log("DataBase_Connection_Established_Successfully");
    } catch (err) {
        console.log("DB Error:", err);
        throw err;
    }
};



const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(morgan("dev")); 

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.post('/api/sign-upload', (req, res) => {
    try {
        const timestamp = Math.round(new Date().getTime() / 1000);
        const folder = "Salary_Manager";
        const { public_id } = req.body;
        
        const paramsToSign = {
            timestamp: timestamp,
            folder: folder,
        };
        if (public_id) {
            paramsToSign.public_id = public_id;
        }

        const signature = cloudinary.utils.api_sign_request(
            paramsToSign,
            process.env.API_SECRET
        );

        res.json({
            signature: signature,
            timestamp: timestamp,
            cloud_name: process.env.CLOUD_NAME,
            api_key: process.env.API_KEY,
            folder: folder,
            public_id: public_id
        });
    } catch (err) {
        console.error("Signing error:", err);
        res.status(500).json({ error: "Failed to generate upload signature" });
    }
});

// ROUTES
app.get('/', async (req, res) => {
    try {
        await connectDB();
        const allEmployees = await data.find(); 
        res.render('index', { title: "Admin Portal | Secure Records", employees: allEmployees });
    } catch (err) {
        console.log("Fetch Error:", err);
        res.status(500).send("Database se data laane me dikkat aayi!");
    }
});

// POST: ADD NEW RECORD
app.post('/add', upload.array('documents', 15), async (req, res) => {
    try {
        await connectDB();
        const { name, position } = req.body;
        let docNames = req.body.docNames || [];
        if (!Array.isArray(docNames)) { docNames = [docNames]; }

        let docUrls = req.body.docUrls || [];
        if (!Array.isArray(docUrls)) { docUrls = [docUrls]; }

        const finalDocuments = [];

        // 1. Process client-uploaded files if any
        for (let i = 0; i < docUrls.length; i++) {
            if (docUrls[i]) {
                const title = docNames[i] ? docNames[i] : `Document ${i+1}`;
                finalDocuments.push({ title: title, url: docUrls[i] });
            }
        }

        // 2. Fallback: Process backend-uploaded files if any
        if (req.files && req.files.length > 0) {
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const title = docNames[finalDocuments.length] ? docNames[finalDocuments.length] : `Document ${finalDocuments.length + 1}`;
                const ext = file.originalname.split('.').pop().toLowerCase();

                const resourceType = 'image';
                const uploadResult = await new Promise((resolve, reject) => {
                    const cld_upload_stream = cloudinary.uploader.upload_stream(
                        { folder: "Salary_Manager", resource_type: resourceType, format: ext, public_id: Date.now() + '-' + file.originalname.split('.')[0] },
                        (error, result) => { if (error) reject(error); else resolve(result); }
                    );
                    streamifier.createReadStream(file.buffer).pipe(cld_upload_stream);
                });
                finalDocuments.push({ title: title, url: uploadResult.secure_url });
            }
        }

        const newRecord = new data({ name: name, position: position, documents: finalDocuments });
        await newRecord.save();
        res.redirect('/');
    } catch (error) {
        console.log(error);
        res.status(500).send("Upload failed!");
    }
});

// 🔥 POST: UPDATE/EDIT ROUTE (Granular Selective Logic Perfected)
app.post('/update/:id', upload.array('documents', 15), async (req, res) => {
    try {
        await connectDB();
        const id = req.params.id;
        const { name, position } = req.body;
        
        // Frontend se jo documents bache hain unki strict IDs aayengi
        let retainedDocIds = req.body.retainedDocs || [];
        if (!Array.isArray(retainedDocIds)) { retainedDocIds = [retainedDocIds]; }

        let docNames = req.body.docNames || [];
        if (!Array.isArray(docNames)) { docNames = [docNames]; }

        let docUrls = req.body.docUrls || [];
        if (!Array.isArray(docUrls)) { docUrls = [docUrls]; }

        const currentRecord = await data.findById(id);
        if (!currentRecord) return res.status(404).send("Record nahi mila!");

        let finalUpdatedDocuments = [];

        // 1. Purane records check karo jo user ne delete nahi kiye hain
        currentRecord.documents.forEach(doc => {
            if (retainedDocIds.includes(doc._id.toString())) {
                finalUpdatedDocuments.push(doc); // Retained safely
            } else {
                // Remove physically if it was a local Mac storage PDF
                if (doc.url.startsWith('/uploads/')) {
                    const filePath = path.join(__dirname, doc.url);
                    try {
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    } catch (err) {
                        console.log("Local file deletion ignored:", err.message);
                    }
                }
            }
        });

        // 2. Process client-uploaded files if any
        for (let i = 0; i < docUrls.length; i++) {
            if (docUrls[i]) {
                const title = docNames[i] ? docNames[i] : `Updated Doc ${i+1}`;
                finalUpdatedDocuments.push({ title: title, url: docUrls[i] });
            }
        }

        // 3. Fallback: Process incoming new extra files batch if exists (multer)
        if (req.files && req.files.length > 0) {
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const title = docNames[docUrls.length + i] ? docNames[docUrls.length + i] : `Updated Doc ${docUrls.length + i + 1}`;
                const ext = file.originalname.split('.').pop().toLowerCase();

                const resourceType = 'image';
                const uploadResult = await new Promise((resolve, reject) => {
                    const cld_upload_stream = cloudinary.uploader.upload_stream(
                        { folder: "Salary_Manager", resource_type: resourceType, format: ext, public_id: Date.now() + '-' + file.originalname.split('.')[0] },
                        (error, result) => { if (error) reject(error); else resolve(result); }
                    );
                    streamifier.createReadStream(file.buffer).pipe(cld_upload_stream);
                });
                finalUpdatedDocuments.push({ title: title, url: uploadResult.secure_url });
            }
        }

        // Execution of precise updates
        await data.findByIdAndUpdate(id, {
            name: name,
            position: position,
            documents: finalUpdatedDocuments
        });

        res.redirect('/');
    } catch (error) {
        console.log("Update Error:", error);
        res.status(500).send("Record update karne me error aaya.");
    }
});

// POST: DELETE ROUTE
app.post('/delete/:id', async (req, res) => {
    try {
        await connectDB();
        const id = req.params.id;
        const record = await data.findById(id);
        if (record) {
            record.documents.forEach(doc => {
                if (doc.url.startsWith('/uploads/')) {
                    const filePath = path.join(__dirname, doc.url);
                    try {
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    } catch (err) {
                        console.log("Local file deletion ignored:", err.message);
                    }
                }
            });
            await data.findByIdAndDelete(id);
        }
        res.redirect('/');
    } catch (error) {
        res.status(500).send("Delete error.");
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Server Is Running On Port " + (process.env.PORT || 3000));
});

module.exports = app;