require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'edu_erp_secret_2025';

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'EduERP API running' }));

// ── Schemas ──
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

const studentSchema = new mongoose.Schema({
  rollNo: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: String, phone: String, branch: String,
  semester: String, division: String,
  status: { type: String, default: 'active' },
}, { timestamps: true });
const Student = mongoose.model('Student', studentSchema);

const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  subject: String, date: Date,
  status: { type: String, enum: ['present', 'absent'], default: 'absent' },
  branch: String, division: String,
}, { timestamps: true });
const Attendance = mongoose.model('Attendance', attendanceSchema);

const marksSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  subject: String, semester: String,
  midterm1: { type: Number, default: 0 },
  midterm2: { type: Number, default: 0 },
  assignment: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  grade: String,
}, { timestamps: true });
const Marks = mongoose.model('Marks', marksSchema);

// ── Middleware ──
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

// ── Routes ──
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const user = await User.findOne({ email, role });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already exists' });
    const user = await User.create({ name, email, password, role });
    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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

app.post('/api/students', protect, restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.create(req.body);
    res.status(201).json(student);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/students/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id, req.body, { new: true }
    );
    res.json(student);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/students/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Student deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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

app.get('/api/attendance/student/:id', protect, async (req, res) => {
  try {
    const records = await Attendance.find({ studentId: req.params.id });
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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

app.get('/api/marks/student/:id', protect, async (req, res) => {
  try {
    const marks = await Marks.find({ studentId: req.params.id });
    res.json(marks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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

// ── MongoDB Connect ──
const MONGO_URI = process.env.MONGO_URI;

console.log("🔍 Connecting to MongoDB...");

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected successfully!');
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} (no DB)`));
  });