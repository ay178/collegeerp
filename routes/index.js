// ═══════════════════════════════════════════════════
// routes/auth.js — Login, Register, Profile
// ═══════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
// const User = require('../models/User');
// const { generateToken, protect } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password || !role) return res.status(400).json({ message: 'All fields required' });

    const user = await User.findOne({ email, role });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken({ id: user._id, role: user.role, name: user.name, email: user.email });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/register  (Admin only in production)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already registered' });

    const user = await User.create({ name, email, password, role });
    const token = generateToken({ id: user._id, role: user.role, name: user.name, email: user.email });
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;


// ═══════════════════════════════════════════════════
// routes/students.js — CRUD for Students
// ═══════════════════════════════════════════════════
const studentRouter = express.Router();
// const Student = require('../models/Student');

// GET /api/students  — list with filter/search
studentRouter.get('/', protect, async (req, res) => {
  try {
    const { branch, semester, division, status, search } = req.query;
    const filter = {};
    if (branch) filter.branch = branch;
    if (semester) filter.semester = semester;
    if (division) filter.division = division;
    if (status) filter.status = status;
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

// GET /api/students/:id
studentRouter.get('/:id', protect, async (req, res) => {
  try {
    const student = await Student.findById(req.params.id).populate('userId', 'email');
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/students  — admin only
studentRouter.post('/', protect, restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.create(req.body);
    res.status(201).json(student);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/students/:id
studentRouter.put('/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/students/:id
studentRouter.delete('/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json({ message: 'Student deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/students/:id/dashboard — student's own dashboard data
studentRouter.get('/:id/dashboard', protect, async (req, res) => {
  try {
    const [attendance, marks] = await Promise.all([
      Attendance.find({ studentId: req.params.id }),
      Marks.find({ studentId: req.params.id }),
    ]);
    const subjects = [...new Set(attendance.map(a => a.subject))];
    const attSummary = subjects.map(sub => {
      const records = attendance.filter(a => a.subject === sub);
      const present = records.filter(r => r.status === 'present').length;
      return { subject: sub, present, total: records.length, percentage: Math.round((present / records.length) * 100) };
    });
    res.json({ attendance: attSummary, marks });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = studentRouter;


// ═══════════════════════════════════════════════════
// routes/attendance.js — Mark & Get Attendance
// ═══════════════════════════════════════════════════
const attRouter = express.Router();

// POST /api/attendance/mark  — teacher marks attendance for a class
attRouter.post('/mark', protect, restrictTo('teacher', 'admin'), async (req, res) => {
  try {
    const { records, subject, date, semester, branch, division } = req.body;
    // records = [{ studentId, status }]
    const ops = records.map(r => ({
      updateOne: {
        filter: { studentId: r.studentId, subject, date: new Date(date) },
        update: { $set: { status: r.status, teacherId: req.user.id, semester, branch, division } },
        upsert: true,
      }
    }));
    await Attendance.bulkWrite(ops);
    res.json({ message: `Attendance marked for ${records.length} students` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/student/:studentId  — get student's attendance
attRouter.get('/student/:studentId', protect, async (req, res) => {
  try {
    const { subject, month } = req.query;
    const filter = { studentId: req.params.studentId };
    if (subject) filter.subject = subject;
    if (month) {
      const start = new Date(month); start.setDate(1);
      const end = new Date(month); end.setMonth(end.getMonth() + 1);
      filter.date = { $gte: start, $lt: end };
    }
    const records = await Attendance.find(filter).sort({ date: -1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/class — get class attendance for a date/subject
attRouter.get('/class', protect, restrictTo('teacher', 'admin'), async (req, res) => {
  try {
    const { subject, date, branch, division } = req.query;
    const records = await Attendance.find({ subject, date: new Date(date), branch, division })
      .populate('studentId', 'name rollNo');
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/report  — admin: department/branch wise
attRouter.get('/report', protect, restrictTo('admin'), async (req, res) => {
  try {
    const report = await Attendance.aggregate([
      { $group: { _id: { branch: '$branch', subject: '$subject', status: '$status' }, count: { $sum: 1 } } },
      { $sort: { '_id.branch': 1, '_id.subject': 1 } },
    ]);
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = attRouter;


// ═══════════════════════════════════════════════════
// routes/marks.js — Enter & Get Marks
// ═══════════════════════════════════════════════════
const marksRouter = express.Router();

// POST /api/marks  — teacher enters marks
marksRouter.post('/', protect, restrictTo('teacher', 'admin'), async (req, res) => {
  try {
    const { entries } = req.body; // [{ studentId, subject, semester, academicYear, midterm1, midterm2, assignment, practical }]
    const ops = entries.map(e => ({
      updateOne: {
        filter: { studentId: e.studentId, subject: e.subject, semester: e.semester, academicYear: e.academicYear },
        update: { $set: { ...e, teacherId: req.user.id } },
        upsert: true,
      }
    }));
    await Marks.bulkWrite(ops);
    res.json({ message: 'Marks saved successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/marks/student/:studentId
marksRouter.get('/student/:studentId', protect, async (req, res) => {
  try {
    const marks = await Marks.find({ studentId: req.params.studentId }).sort({ subject: 1 });
    res.json(marks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/marks/class?subject=&semester=&branch=&division=
marksRouter.get('/class', protect, restrictTo('teacher', 'admin'), async (req, res) => {
  try {
    const { subject, semester, branch, division } = req.query;
    // Join with Student to filter by branch/division
    const students = await Student.find({ branch, division, semester });
    const studentIds = students.map(s => s._id);
    const marks = await Marks.find({ studentId: { $in: studentIds }, subject, semester })
      .populate('studentId', 'name rollNo');
    res.json(marks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = marksRouter;


// ═══════════════════════════════════════════════════
// routes/admin.js — Admin-only stats & management
// ═══════════════════════════════════════════════════
const adminRouter = express.Router();
// All admin routes are protected
adminRouter.use(protect, restrictTo('admin'));

// GET /api/admin/stats  — dashboard counts
adminRouter.get('/stats', async (req, res) => {
  try {
    const [students, teachers, activeSt] = await Promise.all([
      Student.countDocuments(),
      Teacher.countDocuments({ status: 'active' }),
      Student.countDocuments({ status: 'active' }),
    ]);
    res.json({ totalStudents: students, totalTeachers: teachers, activeStudents: activeSt });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/teachers
adminRouter.get('/teachers', async (req, res) => {
  try {
    const teachers = await Teacher.find().populate('userId', 'email');
    res.json(teachers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/teachers
adminRouter.post('/teachers', async (req, res) => {
  try {
    const teacher = await Teacher.create(req.body);
    res.status(201).json(teacher);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/admin/teachers/:id
adminRouter.put('/teachers/:id', async (req, res) => {
  try {
    const teacher = await Teacher.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(teacher);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = adminRouter;
