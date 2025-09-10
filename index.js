// server.js
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
require("dotenv").config();
const fs = require("fs");

const app = express();
const port = process.env.PORT || 7000;

// ========== Middleware ==========
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// ========== JWT verify middleware (required) ==========
function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        console.log("❌ No Authorization header");
        return res.status(401).send({ success: false, message: "Unauthorized: No token provided" });
    }
    const token = authHeader.split(" ")[1];
    console.log("🔑 Incoming Token:", token);

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log("❌ JWT Verify Failed:", err.message);
            return res.status(403).send({ success: false, message: "Forbidden: Invalid token" });
        }
        console.log("✅ JWT Decoded:", decoded);
        req.decoded = decoded;
        next();
    });
}


// ========== Multer (photo upload) ==========
const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    },
});
const upload = multer({ storage });

// ========== MongoDB ==========
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.PASSWORD}@cluster0.z1t2q.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

// helper: generate unique 5-digit studentId (string), ensure no collision
async function generateUniqueStudentId(studentCollection) {
    const min = 10000, max = 99999;
    for (let i = 0; i < 10; i++) { // up to 10 tries
        const candidate = String(Math.floor(Math.random() * (max - min + 1)) + min);
        const exists = await studentCollection.findOne({ studentId: candidate });
        if (!exists) return candidate;
    }
    // fallback: use timestamp slice
    return String(Date.now()).slice(-5);
}

// ========== Server start ==========
async function serverStart() {
    try {
        await client.connect();
        console.log("✅ MongoDB Connected");

        const db = client.db("Ds-Madrasah");
        const studentCollection = db.collection("StudentList");
        const resultCollection = db.collection("Results");
        const adminCollection = db.collection("Admins");
        const teacherCollection = db.collection("Teachers");
        const noticeCollection = db.collection("Notices");
        const galleryCollection = db.collection("Gallery");


        // Visitors Collection
        const visitorCollection = db.collection("Visitors");

        // API: Increment visitor count
        app.post("/visitors", async (req, res) => {
            try {
                const today = new Date().toISOString().slice(0, 10); // আজকের তারিখ
                await visitorCollection.updateOne(
                    { date: today },
                    { $inc: { count: 1 } },
                    { upsert: true }
                );

                const totalVisitors = await visitorCollection.aggregate([
                    { $group: { _id: null, total: { $sum: "$count" } } }
                ]).toArray();

                res.send({ success: true, total: totalVisitors[0]?.total || 0 });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // API: Get total visitors
        app.get("/visitors", async (req, res) => {
            try {
                const totalVisitors = await visitorCollection.aggregate([
                    { $group: { _id: null, total: { $sum: "$count" } } }
                ]).toArray();

                res.send({ success: true, total: totalVisitors[0]?.total || 0 });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });


        // ====================
        // Gallery APIs
        // ====================
        // Upload Gallery Item (Admin Only)
        app.post("/gallery", verifyJWT, upload.single("file"), async (req, res) => {
            try {
                const { title } = req.body;
                if (!title || !req.file) {
                    return res.status(400).send({ success: false, message: "Title and Image required" });
                }

                const newImage = {
                    title,
                    img: `/uploads/${req.file.filename}`,
                    createdAt: new Date(),
                };

                const result = await galleryCollection.insertOne(newImage);
                res.send({ success: true, insertedId: result.insertedId, data: newImage });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Get all gallery items (Public)
        app.get("/gallery", async (req, res) => {
            try {
                const items = await galleryCollection.find().sort({ createdAt: -1 }).toArray();
                res.send(items);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Delete gallery item (Admin Only)
        app.delete("/gallery/:id", verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const image = await galleryCollection.findOne({ _id: new ObjectId(id) });

                if (!image) {
                    return res.status(404).send({ success: false, message: "Image not found" });
                }

                // delete file from uploads folder
                if (image.img) {
                    const filePath = path.join(__dirname, image.img);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }

                const result = await galleryCollection.deleteOne({ _id: new ObjectId(id) });
                res.send({ success: true, deletedCount: result.deletedCount });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });


        // 📌 Add Notice (Admin Only)
        // ====================
        // Notice APIs
        // ====================

        // Add Notice (Admin Only)
        app.post("/notices", verifyJWT, upload.single("file"), async (req, res) => {
            try {
                const { title } = req.body;
                if (!title) {
                    return res.status(400).send({ success: false, message: "Title is required" });
                }

                const newNotice = {
                    title,
                    file: req.file ? `/uploads/${req.file.filename}` : null,
                    createdAt: new Date(),
                };

                const result = await noticeCollection.insertOne(newNotice);
                res.send({ success: true, notice: newNotice, insertedId: result.insertedId });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Get All Notices (Public)
        app.get("/notices", async (req, res) => {
            try {
                const notices = await noticeCollection.find().sort({ createdAt: -1 }).toArray();
                res.send(notices);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Delete Notice (Admin Only)
        app.delete("/notices/:id", verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const notice = await noticeCollection.findOne({ _id: new ObjectId(id) });
                if (!notice) {
                    return res.status(404).send({ success: false, message: "Notice not found" });
                }

                // Delete file if exists
                if (notice.file) {
                    const filePath = path.join(__dirname, notice.file);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }

                const result = await noticeCollection.deleteOne({ _id: new ObjectId(id) });
                res.send({ success: true, deletedCount: result.deletedCount });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });




        /* ====================
           Teacher APIs
        ==================== */
        // Add Teacher (with optional photo) - protected
        app.post("/teachers", verifyJWT, upload.single("photo"), async (req, res) => {
            try {
                const data = req.body || {};
                if (req.file) data.photo = `/uploads/${req.file.filename}`;
                else data.photo = data.photo || null;
                data.createdAt = new Date();
                const result = await teacherCollection.insertOne(data);
                res.send({ success: true, insertedId: result.insertedId });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Get all teachers (public)
        app.get("/teachers", async (req, res) => {
            try {
                const teachers = await teacherCollection.find().toArray();
                res.send(teachers);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Get teacher by id (public)
        app.get("/teachers/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const teacher = await teacherCollection.findOne({ _id: new ObjectId(id) });
                if (!teacher) return res.status(404).send({ success: false, message: "Teacher not found" });
                res.send(teacher);
            } catch (error) {
                res.status(400).send({ success: false, message: "Invalid ID format" });
            }
        });

        // Update teacher (protected)
        app.put("/teachers/:id", verifyJWT, upload.single("photo"), async (req, res) => {
            try {
                const id = req.params.id;
                const updatedData = req.body || {};
                if (req.file) updatedData.photo = `/uploads/${req.file.filename}`;
                const result = await teacherCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedData });
                res.send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Delete teacher (protected)
        app.delete("/teachers/:id", verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const result = await teacherCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });


        /* ====================
           Student APIs
           NOTE: GET /students is public for easy frontend fetch (change later if you want protection)
        ==================== */

        // GET /students  — supports filters via query params:
        // class, year, roll, section, shift, group
        // GET /students
        app.get("/students", async (req, res) => {
            try {
                const { class: studentClass, year, roll, section, shift, group } = req.query;
                const query = {};

                if (studentClass) query.class = studentClass.toString();
                if (year) query.year = year.toString();
                if (section) query.section = section;
                if (shift) query.shift = shift;
                if (group) query.group = group;

                if (roll) {
                    query.$or = [
                        { roll: roll.toString() },      // string match
                        { roll: parseInt(roll) }        // number match (in case saved as int)
                    ];
                }

                const students = await studentCollection.find(query).toArray();
                res.send(students);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });


        // POST /students - protected
        app.post("/students", verifyJWT, async (req, res) => {
            try {
                const data = req.body || {};

                // normalize class/year to string (stored consistently)
                if (data.class !== undefined) data.class = data.class.toString();
                if (data.year !== undefined) data.year = data.year.toString();

                // uniqueness check: birthReg + class + year
                if (!data.birthReg || !data.class || !data.year) {
                    return res.status(400).send({ success: false, message: "Missing required fields: birthReg/class/year" });
                }

                const exists = await studentCollection.findOne({
                    birthReg: data.birthReg,
                    class: data.class,
                    year: data.year,
                });
                if (exists) return res.status(400).send({ success: false, message: "Student already exists" });

                // add createdAt
                data.createdAt = new Date();

                // generate unique 5-digit studentId if not provided
                if (!data.studentId) {
                    data.studentId = await generateUniqueStudentId(studentCollection);
                } else {
                    // if provided, ensure uniqueness
                    const ex2 = await studentCollection.findOne({ studentId: data.studentId });
                    if (ex2) {
                        // override with generated unique one
                        data.studentId = await generateUniqueStudentId(studentCollection);
                    }
                }

                const result = await studentCollection.insertOne(data);
                res.send({ success: true, insertedId: result.insertedId, studentId: data.studentId });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Update Student (protected)
        app.put("/students/:id", verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const updatedData = req.body || {};

                // keep consistent types
                if (updatedData.class !== undefined) updatedData.class = updatedData.class.toString();
                if (updatedData.year !== undefined) updatedData.year = updatedData.year.toString();

                const result = await studentCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedData });
                res.send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Delete Student (protected)
        app.delete("/students/:id", verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const result = await studentCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount > 0) {
                    res.send({ success: true });
                } else {
                    res.send({ success: false, message: "Not found" });
                }
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });



        // ====================
        // Result APIs
        // ====================

        // Publish Result (Admin Protected)
        app.post("/results", verifyJWT, async (req, res) => {
            try {
                const { roll, name, class: studentClass, marks, examType, year } = req.body;

                if (!roll || !name || !studentClass || !marks || !examType || !year) {
                    return res.status(400).send({ success: false, message: "Missing fields" });
                }

                // check if exists
                const existsR = await resultCollection.findOne({
                    roll: roll.toString(),
                    class: studentClass.toString(),
                    examType,
                    year: parseInt(year),   // ✅ FIXED
                });

                if (existsR) {
                    return res.status(400).send({ success: false, message: "Result already exists" });
                }

                // prepare new result
                const newResult = {
                    roll: roll.toString(),
                    name,
                    class: studentClass.toString(),
                    marks,
                    examType,
                    year: parseInt(year),   // ✅ always number
                    createdAt: new Date(),
                };

                const result = await resultCollection.insertOne(newResult);
                res.send({ success: true, insertedId: result.insertedId, data: newResult });

            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Get Result by Student (roll + class + examType + year)
        app.get("/results/student/:roll/:classId/:examType/:year", async (req, res) => {
            try {
                const { roll, classId, examType, year } = req.params;

                const result = await resultCollection.findOne({
                    roll: roll.toString(),
                    class: classId.toString(),
                    examType,
                    year: parseInt(year),  // ✅ FIXED
                });

                if (!result) {
                    return res.send({ success: false, message: "Result not found" });
                }

                res.send({ success: true, data: result });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });


        // ... other results endpoints remain same as earlier code (omitted here for brevity)
        // (You can copy/paste your previous results endpoints if needed)

        // =====================
        // Dashboard Stats (dynamic)
        // =====================
        app.get("/dashboard/stats", async (req, res) => {
            try {
                const totalStudents = await studentCollection.countDocuments();
                const totalTeachers = await teacherCollection.countDocuments();
                const totalResults = await resultCollection.countDocuments();

                const genderWise = await studentCollection.aggregate([
                    { $group: { _id: "$gender", count: { $sum: 1 } } }
                ]).toArray();

                const classWise = await studentCollection.aggregate([
                    { $group: { _id: "$class", students: { $sum: 1 } } },
                    { $sort: { _id: 1 } }
                ]).toArray();

                res.send({
                    success: true,
                    stats: {
                        totalStudents,
                        totalTeachers,
                        totalResults,
                        genderWise,
                        classWise
                    }
                });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });


        /* ====================
           Admin APIs
        ==================== */
        app.post("/admin/login", async (req, res) => {
            try {
                const { email, password } = req.body;
                const admin = await adminCollection.findOne({ email });
                if (!admin) return res.status(401).send({ success: false, message: "Invalid credentials" });

                const isMatch = await bcrypt.compare(password, admin.password);
                if (!isMatch) return res.status(401).send({ success: false, message: "Invalid credentials" });

                const token = jwt.sign(
                    { email: admin.email, role: admin.role },
                    process.env.JWT_SECRET,   // <-- এটা তোমার .env এর key নিতে হবে
                    { expiresIn: "2h" }
                );

                res.send({ success: true, token, role: admin.role });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        app.get("/admin/dashboard", verifyJWT, async (req, res) => {
            res.send({ success: true, message: "Welcome to Admin Dashboard", user: req.decoded });
        });

    } finally {
        // keep client open
    }
}
serverStart().catch(console.dir);

// Root
app.get("/", (req, res) => {
    res.send("✅ Server Running with Student, Result, Teacher & Admin APIs");
});

// Start server
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});
