require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// Middleware
app.use(cors({ 
  origin: ['http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:5000', 'file://'],
  credentials: true 
}));
app.use(express.json());

// Health check
app.get('/', (req, res) => res.json({ status: 'EduERP API running', version: '1.0.0' }));

// Models
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'edu_erp_secret_2025';

// ── User Schema ──
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'teacher', 'admin'], required: true },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
const User = mongoose.model('User', userSchema);

// ── Teacher Schema ──
const teacherSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: String,
  department: String,
  subjects: [String],
  qualifications: String,
  experience: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true });
const Teacher = mongoose.model('Teacher', teacherSchema);

// ── Student Schema ──
const studentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rollNo: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: String,
  phone: String,
  branch: String,
  semester: String,
  division: String,
  status: { type: String, default: 'active' },
}, { timestamps: true });
const Student = mongoose.model('Student', studentSchema);

// ── Attendance Schema ──
const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  subject: String,
  date: Date,
  status: { type: String, enum: ['present', 'absent'], default: 'absent' },
  branch: String,
  division: String,
}, { timestamps: true });
const Attendance = mongoose.model('Attendance', attendanceSchema);

// ── Marks Schema ──
const marksSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  subject: String,
  semester: String,
  midterm1: { type: Number, default: 0 },
  midterm2: { type: Number, default: 0 },
  assignment: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  grade: String,
}, { timestamps: true });
const Marks = mongoose.model('Marks', marksSchema);

// ── Auth Middleware ──
const protect = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ message: 'Not authorized' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ message: 'Access denied' });
  next();
};

// ════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const user = await User.findOne({ email, role });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already exists' });
    const user = await User.create({ name, email, password, role });
    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/students
app.get('/api/students', protect, async (req, res) => {
  try {
    const { branch, semester, division, search } = req.query;
    const filter = {};
    if (branch) filter.branch = branch;
    if (semester) filter.semester = semester;
    if (division) filter.division = division;
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { rollNo: { $regex: search, $options: 'i' } },
    ];
    const students = await Student.find(filter).sort({ rollNo: 1 });
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/students
app.post('/api/students', protect, restrictTo('admin'), async (req, res) => {
  try {
    const { name, email, password, rollNo, phone, branch, semester, division, status } = req.body;
    
    // Validate required fields
    if (!name || !email || !password || !rollNo) {
      return res.status(400).json({ message: 'Name, email, password, and roll number are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Create User account (will hash password in pre-save middleware)
    const user = await User.create({ name, email, password, role: 'student' });

    // Create Student record
    const student = await Student.create({
      name,
      email,
      rollNo,
      phone,
      branch,
      semester,
      division,
      status: status || 'active',
      userId: user._id
    });

    res.status(201).json({
      student,
      loginCredentials: { email, password: req.body.password, role: 'student' }
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/students/:id
app.put('/api/students/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(student);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/students/:id
app.delete('/api/students/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Student deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/teachers
app.get('/api/teachers', protect, async (req, res) => {
  try {
    const { department, search, status } = req.query;
    const filter = {};
    if (department) filter.department = department;
    if (status) filter.status = status;
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
    const teachers = await Teacher.find(filter).sort({ name: 1 });
    res.json(teachers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/teachers/:id
app.get('/api/teachers/:id', protect, async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
    res.json(teacher);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/teachers
app.post('/api/teachers', protect, restrictTo('admin'), async (req, res) => {
  try {
    const teacher = await Teacher.create(req.body);
    res.status(201).json(teacher);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/teachers/:id
app.put('/api/teachers/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    const teacher = await Teacher.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(teacher);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/teachers/:id
app.delete('/api/teachers/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    await Teacher.findByIdAndDelete(req.params.id);
    res.json({ message: 'Teacher deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/attendance/mark
app.post('/api/attendance/mark', protect, restrictTo('teacher', 'admin'), async (req, res) => {
  try {
    const { records, subject, date, branch, division } = req.body;
    const ops = records.map(r => ({
      updateOne: {
        filter: { studentId: r.studentId, subject, date: new Date(date) },
        update: { $set: { status: r.status, branch, division } },
        upsert: true,
      }
    }));
    await Attendance.bulkWrite(ops);
    res.json({ message: 'Attendance saved' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/student/:id
app.get('/api/attendance/student/:id', protect, async (req, res) => {
  try {
    const records = await Attendance.find({ studentId: req.params.id });
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/marks
app.post('/api/marks', protect, restrictTo('teacher', 'admin'), async (req, res) => {
  try {
    const { entries } = req.body;
    const ops = entries.map(e => {
      const total = (e.midterm1||0) + (e.midterm2||0) + (e.assignment||0);
      const grade = total>=80?'A+':total>=70?'A':total>=60?'B+':total>=50?'B':'C';
      return {
        updateOne: {
          filter: { studentId: e.studentId, subject: e.subject, semester: e.semester },
          update: { $set: { ...e, totalMarks: total, grade } },
          upsert: true,
        }
      };
    });
    await Marks.bulkWrite(ops);
    res.json({ message: 'Marks saved' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/marks/student/:id
app.get('/api/marks/student/:id', protect, async (req, res) => {
  try {
    const marks = await Marks.find({ studentId: req.params.id });
    res.json(marks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/stats
app.get('/api/admin/stats', protect, restrictTo('admin'), async (req, res) => {
  try {
    const [students, activeStudents] = await Promise.all([
      Student.countDocuments(),
      Student.countDocuments({ status: 'active' }),
    ]);
    res.json({ totalStudents: students, activeStudents });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ════════════════════════════════════════
// MongoDB Connect & Start Server
// ════════════════════════════════════════
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/college_erp';

// Function to start server with fallback ports
function startServer(preferredPort, attempt = 0) {
  const MAX_ATTEMPTS = 100;
  let portNum = Number(preferredPort) || 5000;

  if (attempt >= MAX_ATTEMPTS) {
    console.error(`❌ Could not bind server after ${MAX_ATTEMPTS} attempts. Aborting.`);
    return;
  }

  if (portNum <= 0 || portNum >= 65536) {
    console.error(`❌ Invalid port ${portNum}. Must be between 1 and 65535.`);
    return;
  }

  const server = app.listen(portNum, () => {
    console.log(`🚀 Server running on http://localhost:${portNum}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = portNum + 1;
      console.log(`⚠️  Port ${portNum} is in use, trying port ${nextPort}...`);
      // try next numeric port
      startServer(nextPort, attempt + 1);
    } else {
      console.error('❌ Server error:', err);
    }
  });
}

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    const PORT = process.env.PORT || 5000;
    startServer(PORT);
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    console.log('💡 Frontend (index.html) still works without MongoDB!');
    const PORT = process.env.PORT || 5000;
    startServer(PORT);
  });