const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 7000;

// Middleware
app.use(cors());
app.use(express.json());

// JWT Verify Middleware
function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ success: false, message: "Unauthorized: No token provided" });
    }
    const token = authHeader.split(" ")[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).send({ success: false, message: "Forbidden: Invalid token" });
        }
        req.decoded = decoded;
        next();
    });
}

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.PASSWORD}@cluster0.z1t2q.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function serverStart() {
    try {
        await client.connect();
        console.log("✅ MongoDB Connected");

        const db = client.db("Ds-Madrasah");
        const studentCollection = db.collection("StudentList");
        const resultCollection = db.collection("Results");
        const adminCollection = db.collection("Admins");

        /* ====================
           🟢 Student APIs
        ==================== */

        // Get Students
        app.get("/students", verifyJWT, async (req, res) => {
            try {
                const studentClass = req.query.class;
                let query = {};
                if (studentClass) query = { class: studentClass.toString() };

                const students = await studentCollection.find(query).toArray();
                res.send(students);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Add Student
        app.post("/students", verifyJWT, async (req, res) => {
            try {
                const data = req.body;
                const exists = await studentCollection.findOne({
                    roll: data.roll,
                    class: data.class.toString(),
                    year: data.year,
                });
                if (exists) {
                    return res.status(400).send({ success: false, message: "Student already exists" });
                }
                data.createdAt = new Date();
                const result = await studentCollection.insertOne(data);
                res.send({ success: true, insertedId: result.insertedId });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Update Student
        app.put("/students/:id", verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const updatedData = req.body;
                const result = await studentCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedData }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Delete Student
        app.delete("/students/:id", verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const result = await studentCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        /* ====================
           🟢 Result APIs
        ==================== */

        // Add Result
        app.post("/results", verifyJWT, async (req, res) => {
            try {
                const { roll, name, class: studentClass, marks, examType, year } = req.body;
                if (!roll || !name || !studentClass || !marks || !examType || !year) {
                    return res.status(400).send({ success: false, message: "Missing fields" });
                }
                const exists = await resultCollection.findOne({ roll, class: studentClass.toString(), examType, year });
                if (exists) {
                    return res.status(400).send({ success: false, message: "Result already exists" });
                }
                const newResult = {
                    roll,
                    name,
                    class: studentClass.toString(),
                    marks,
                    examType,
                    year: parseInt(year),
                    createdAt: new Date(),
                };
                const result = await resultCollection.insertOne(newResult);
                res.send({ success: true, insertedId: result.insertedId });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Get Results by Class + Exam + Year
        app.get("/results/class/:classId/:examType/:year", async (req, res) => {
            try {
                const { classId, examType, year } = req.params;
                const results = await resultCollection
                    .find({ class: classId.toString(), examType, year: parseInt(year) })
                    .sort({ roll: 1 })
                    .toArray();
                res.send(results);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Get Single Student Result with Merit
        app.get("/results/student/:roll/:classId/:examType/:year", async (req, res) => {
            try {
                const { roll, classId, examType, year } = req.params;

                const studentResult = await resultCollection.findOne({
                    roll,
                    class: classId.toString(),
                    examType,
                    year: parseInt(year),
                });

                if (!studentResult) {
                    return res.status(404).send({ success: false, message: "Result not found" });
                }

                // Fail / Total Marks Check
                let isFail = false;
                let totalMarks = 0;

                Object.values(studentResult.marks).forEach((mark) => {
                    const written = mark.written || 0;
                    const mcq = mark.mcq || 0;
                    const subTotal = written + mcq;

                    totalMarks += subTotal;

                    if ((mark.mcq !== undefined && (written < 24 || mcq < 10)) ||
                        (mark.mcq === undefined && written < 33)) {
                        isFail = true;
                    }
                });

                // যদি Fail → Merit = "Fail"
                if (isFail) {
                    return res.send({
                        success: true,
                        data: { ...studentResult, totalMarks, meritPosition: "Fail" },
                    });
                }

                // Pass হলে merit হিসাব করো
                const classResults = await resultCollection.find({
                    class: classId.toString(),
                    examType,
                    year: parseInt(year),
                }).toArray();

                const ranked = classResults.map((r) => {
                    let total = 0;
                    let failed = false;

                    Object.values(r.marks).forEach((mark) => {
                        const written = mark.written || 0;
                        const mcq = mark.mcq || 0;
                        const subTotal = written + mcq;
                        total += subTotal;

                        if ((mark.mcq !== undefined && (written < 24 || mcq < 10)) ||
                            (mark.mcq === undefined && written < 33)) {
                            failed = true;
                        }
                    });

                    return { roll: r.roll, total, failed };
                });

                const passed = ranked.filter((s) => !s.failed).sort((a, b) => b.total - a.total);
                const meritPosition = passed.findIndex((s) => s.roll === roll) + 1 || "Fail";

                res.send({
                    success: true,
                    data: { ...studentResult, totalMarks, meritPosition },
                });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Update Result
        app.put("/results/:id", verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const updatedData = req.body;
                const result = await resultCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedData }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Delete Result
        app.delete("/results/:id", verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const result = await resultCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        /* ====================
           🟢 Admin APIs
        ==================== */

        // Admin Login
        app.post("/admin/login", async (req, res) => {
            try {
                const { email, password } = req.body;
                const admin = await adminCollection.findOne({ email });
                if (!admin) return res.status(401).send({ success: false, message: "Invalid credentials" });

                const isMatch = await bcrypt.compare(password, admin.password);
                if (!isMatch) return res.status(401).send({ success: false, message: "Invalid credentials" });

                const token = jwt.sign(
                    { email: admin.email, role: admin.role },
                    process.env.JWT_SECRET,
                    { expiresIn: "2h" }
                );
                res.send({ success: true, token, role: admin.role });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // Admin Dashboard
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
    res.send("✅ Server Running with Student, Result (with Merit) & Admin APIs ❤️");
});

// Start Server
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});


//https://chatgpt.com/c/68bd8303-ba24-8333-9920-7e7eee71e812