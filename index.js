const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const cors = require('cors');
const verifyJWT = require('./middleware/verifyJWT');

const app = express();
const port = process.env.PORT;

// middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.PASSWORD}@cluster0.z1t2q.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function serverStart() {
    try {
        await client.connect();

        const database = client.db('Ds-Madrasah');
        const studentCollection = database.collection('Student List');
        const adminCollection = database.collection('Admins');

        // 🟢 Student List (Open Route)
        app.get('/student-list', async (req, res) => {
            const query = {};
            const students = await studentCollection.find(query).toArray();
            res.send(students);
        });

        // 🟢 Admin Register (One-time use only)
        // app.post('/admin/register', async (req, res) => {
        //     try {
        //         const { name, email, password } = req.body;

        //         // check if admin already exists
        //         const existingAdmin = await adminCollection.findOne({ email });
        //         if (existingAdmin) {
        //             return res.status(400).send({ message: "Admin already exists" });
        //         }

        //         const hashedPassword = await bcrypt.hash(password, 10);
        //         const newAdmin = { name, email, password: hashedPassword, role: "superadmin" };

        //         const result = await adminCollection.insertOne(newAdmin);
        //         res.send({ success: true, insertedId: result.insertedId });
        //     } catch (error) {
        //         res.status(500).send({ message: "Server error", error: error.message });
        //     }
        // });

        // 🟢 Admin Login
        app.post('/admin/login', async (req, res) => {
            try {
                const { email, password } = req.body;

                const admin = await adminCollection.findOne({ email });
                if (!admin) {
                    return res.status(401).send({ message: "Invalid email or password" });
                }

                const isPasswordMatch = await bcrypt.compare(password, admin.password);
                if (!isPasswordMatch) {
                    return res.status(401).send({ message: "Invalid email or password" });
                }

                // JWT Token generate
                const token = jwt.sign(
                    { email: admin.email, role: admin.role },
                    process.env.JWT_SECRET,
                    { expiresIn: '2h' }
                );

                res.send({ success: true, token, role: admin.role });
            } catch (error) {
                res.status(500).send({ message: "Server error", error: error.message });
            }
        });

        // 🟢 Protected Route Example
        app.get('/admin/dashboard', verifyJWT, async (req, res) => {
            res.send({
                message: "Welcome to Admin Dashboard",
                user: req.decoded
            });
        });

    } finally {
        // await client.close();
    }
}
serverStart().catch(console.dir);

// Root
app.get('/', (req, res) => {
    res.send('Hello World! ❤️');
});

// Server Listen
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});


