require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'edu_erp_secret_2025';

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'EduERP API running', version: '2.0.0' }));

// ── Email Transporter ──
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendEmail = async (to, subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('Email not configured — skipping:', subject);
    return false;
  }
  try {
    await transporter.sendMail({
      from: '"EduERP System" <' + process.env.EMAIL_USER + '>',
      to, subject, html,
    });
    console.log('Email sent to:', to);
    return true;
  } catch (err) {
    console.error('Email error:', err.message);
    return false;
  }
};

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
  email: String,
  phone: String,
  branch: String,
  semester: String,
  division: String,
  status: { type: String, default: 'active' },
}, { timestamps: true });
const Student = mongoose.model('Student', studentSchema);

const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  subject: String,
  date: Date,
  status: { type: String, enum: ['present', 'absent'], default: 'absent' },
  branch: String,
  division: String,
}, { timestamps: true });
const Attendance = mongoose.model('Attendance', attendanceSchema);

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

const feeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  studentName: String,
  rollNo: String,
  semester: String,
  amount: Number,
  paid: { type: Number, default: 0 },
  dueDate: Date,
  status: { type: String, enum: ['paid', 'pending', 'overdue'], default: 'pending' },
  paymentDate: Date,
}, { timestamps: true });
const Fee = mongoose.model('Fee', feeSchema);

const examSchema = new mongoose.Schema({
  subject: String,
  examType: String,
  date: Date,
  time: String,
  room: String,
  branch: String,
  semester: String,
  duration: String,
}, { timestamps: true });
const Exam = mongoose.model('Exam', examSchema);

const notifSchema = new mongoose.Schema({
  title: String,
  message: String,
  type: { type: String, enum: ['info', 'success', 'warning', 'danger'], default: 'info' },
  targetRole: { type: String, enum: ['all', 'student', 'teacher', 'admin'], default: 'all' },
  read: { type: Boolean, default: false },
}, { timestamps: true });
const Notification = mongoose.model('Notification', notifSchema);

// ── Middleware ──
const protect = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ message: 'Not authorized' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ message: 'Access denied' });
  next();
};

// ── SEED ROUTE ──
app.get('/api/seed', async (req, res) => {
  try {
    const users = [
      { name: 'Dr. Ramesh Kumar',   email: 'admin@edu.com',   password: 'admin123',  role: 'admin'   },
      { name: 'Prof. Anjali Singh', email: 'teacher@edu.com', password: 'teach123',  role: 'teacher' },
      { name: 'Arjun Mehta',        email: 'student@edu.com', password: 'stud123',   role: 'student' },
    ];
    const results = [];
    for (const u of users) {
      const existing = await User.findOne({ email: u.email });
      if (!existing) {
        await User.create(u);
        results.push('Created: ' + u.email);
      } else {
        results.push('Already exists: ' + u.email);
      }
    }
    res.json({ message: 'Seed done!', results });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Auth Routes ──
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

    // Welcome Email
    await sendEmail(email, 'Welcome to EduERP!', `
      <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;">
        <h2 style="color:#2563eb;">Welcome to EduERP! 🎓</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>Your account has been created successfully.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px;color:#666;">Email</td><td style="padding:8px;font-weight:bold;">${email}</td></tr>
          <tr><td style="padding:8px;color:#666;">Role</td><td style="padding:8px;font-weight:bold;">${role}</td></tr>
        </table>
        <a href="https://college-erp-frontend-rho.vercel.app" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Login Now</a>
      </div>
    `);

    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Student Routes ──
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

    // Welcome email to new student
    if (student.email) {
      await sendEmail(student.email, 'Welcome to EduERP — Student Account Created', `
        <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;">
          <h2 style="color:#2563eb;">Welcome ${student.name}! 🎓</h2>
          <p>Your student account has been created in EduERP.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #eee;border-radius:8px;">
            <tr style="background:#f8f9fa;"><td style="padding:10px;color:#666;">Roll No</td><td style="padding:10px;font-weight:bold;">${student.rollNo}</td></tr>
            <tr><td style="padding:10px;color:#666;">Branch</td><td style="padding:10px;">${student.branch}</td></tr>
            <tr style="background:#f8f9fa;"><td style="padding:10px;color:#666;">Semester</td><td style="padding:10px;">${student.semester}</td></tr>
            <tr><td style="padding:10px;color:#666;">Division</td><td style="padding:10px;">${student.division}</td></tr>
          </table>
          <a href="https://college-erp-frontend-rho.vercel.app" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:8px;">Login to EduERP</a>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-top:12px;">
            <p style="margin:0;font-size:13px;color:#92400e;font-weight:bold;">Login Details:</p>
            <p style="margin:6px 0 0;font-size:13px;color:#78350f;">Email: ${student.email}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#78350f;">Password: ${student.rollNo} (Aapka Roll Number)</p>
            <p style="margin:8px 0 0;font-size:12px;color:#999;">Login ke baad password change karna mat bhoolo!</p>
          </div>
        </div>
      `);
    }

    res.status(201).json(student);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/students/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true });
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

// ── Attendance Routes ──
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

    // Check low attendance and send warning emails
    const absentStudents = records.filter(r => r.status === 'absent');
    for (const rec of absentStudents) {
      const totalClasses = await Attendance.countDocuments({ studentId: rec.studentId, subject, status: { $in: ['present','absent'] } });
      const presentClasses = await Attendance.countDocuments({ studentId: rec.studentId, subject, status: 'present' });
      const pct = totalClasses > 0 ? Math.round((presentClasses / totalClasses) * 100) : 0;
      if (pct < 75 && totalClasses >= 5) {
        const student = await Student.findById(rec.studentId);
        if (student && student.email) {
          await sendEmail(student.email, 'Low Attendance Warning — EduERP', `
            <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;">
              <h2 style="color:#dc2626;">⚠️ Low Attendance Warning</h2>
              <p>Dear <strong>${student.name}</strong>,</p>
              <p>Your attendance in <strong>${subject}</strong> has dropped below 75%.</p>
              <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0;">
                <p style="margin:0;font-size:24px;font-weight:bold;color:#dc2626;">${pct}%</p>
                <p style="margin:4px 0 0;color:#666;">${presentClasses} out of ${totalClasses} classes attended</p>
              </div>
              <p>Please attend classes regularly to avoid detention.</p>
              <a href="https://college-erp-frontend-rho.vercel.app" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Check Attendance</a>
            </div>
          `);
        }
      }
    }

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

// ── Marks Routes ──
app.post('/api/marks', protect, restrictTo('teacher', 'admin'), async (req, res) => {
  try {
    const { entries } = req.body;
    const ops = entries.map(e => {
      const total = (e.midterm1 || 0) + (e.midterm2 || 0) + (e.assignment || 0);
      const grade = total >= 80 ? 'A+' : total >= 70 ? 'A' : total >= 60 ? 'B+' : total >= 50 ? 'B' : 'C';
      return {
        updateOne: {
          filter: { studentId: e.studentId, subject: e.subject, semester: e.semester },
          update: { $set: { ...e, totalMarks: total, grade } },
          upsert: true,
        }
      };
    });
    await Marks.bulkWrite(ops);

    // Send marks update email
    for (const e of entries) {
      const student = await Student.findById(e.studentId);
      if (student && student.email) {
        const total = (e.midterm1 || 0) + (e.midterm2 || 0) + (e.assignment || 0);
        const grade = total >= 80 ? 'A+' : total >= 70 ? 'A' : total >= 60 ? 'B+' : total >= 50 ? 'B' : 'C';
        await sendEmail(student.email, 'Marks Updated — ' + e.subject + ' — EduERP', `
          <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;">
            <h2 style="color:#2563eb;">📊 Marks Updated</h2>
            <p>Dear <strong>${student.name}</strong>,</p>
            <p>Your marks for <strong>${e.subject}</strong> have been updated.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #eee;border-radius:8px;">
              <tr style="background:#f8f9fa;"><td style="padding:10px;">Mid-Term 1</td><td style="padding:10px;font-weight:bold;">${e.midterm1 || 0} / 30</td></tr>
              <tr><td style="padding:10px;">Mid-Term 2</td><td style="padding:10px;font-weight:bold;">${e.midterm2 || 0} / 30</td></tr>
              <tr style="background:#f8f9fa;"><td style="padding:10px;">Assignment</td><td style="padding:10px;font-weight:bold;">${e.assignment || 0} / 20</td></tr>
              <tr style="background:#eff6ff;"><td style="padding:10px;font-weight:bold;">Total</td><td style="padding:10px;font-weight:bold;font-size:18px;color:#2563eb;">${total} / 100 (${grade})</td></tr>
            </table>
            <a href="https://college-erp-frontend-rho.vercel.app" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">View Full Marksheet</a>
          </div>
        `);
      }
    }

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

// ── Fee Routes ──
app.get('/api/fees', protect, async (req, res) => {
  try {
    const fees = await Fee.find().populate('studentId', 'name rollNo');
    res.json(fees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/fees', protect, restrictTo('admin'), async (req, res) => {
  try {
    const fee = await Fee.create(req.body);
    res.status(201).json(fee);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/fees/:id/pay', protect, restrictTo('admin'), async (req, res) => {
  try {
    const fee = await Fee.findByIdAndUpdate(
      req.params.id,
      { status: 'paid', paid: req.body.amount, paymentDate: new Date() },
      { new: true }
    );

    // Payment confirmation email
    const student = await Student.findById(fee.studentId);
    if (student && student.email) {
      await sendEmail(student.email, 'Fee Payment Confirmed — EduERP', `
        <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;">
          <h2 style="color:#16a34a;">✅ Fee Payment Confirmed</h2>
          <p>Dear <strong>${student.name}</strong>,</p>
          <p>Your fee payment has been recorded successfully.</p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0;">
            <p style="margin:0;font-size:22px;font-weight:bold;color:#16a34a;">₹${fee.paid.toLocaleString()}</p>
            <p style="margin:4px 0 0;color:#666;">Semester: ${fee.semester}</p>
            <p style="margin:4px 0 0;color:#666;">Date: ${new Date().toLocaleDateString('en-IN')}</p>
          </div>
          <a href="https://college-erp-frontend-rho.vercel.app" style="background:#16a34a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">View Fee Receipt</a>
        </div>
      `);
    }

    res.json(fee);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── Exam Routes ──
app.get('/api/exams', protect, async (req, res) => {
  try {
    const exams = await Exam.find().sort({ date: 1 });
    res.json(exams);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/exams', protect, restrictTo('admin'), async (req, res) => {
  try {
    const exam = await Exam.create(req.body);
    res.status(201).json(exam);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/exams/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    await Exam.findByIdAndDelete(req.params.id);
    res.json({ message: 'Exam deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Notification Routes ──
app.get('/api/notifications', protect, async (req, res) => {
  try {
    const notifs = await Notification.find({
      $or: [{ targetRole: 'all' }, { targetRole: req.user.role }]
    }).sort({ createdAt: -1 }).limit(20);
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/notifications/send', protect, restrictTo('admin'), async (req, res) => {
  try {
    const { title, message, type, targetRole, sendEmail: doEmail } = req.body;
    const notif = await Notification.create({ title, message, type, targetRole });

    // Send email to all users of that role
    if (doEmail) {
      const users = await User.find(targetRole === 'all' ? {} : { role: targetRole });
      for (const u of users) {
        await sendEmail(u.email, title + ' — EduERP', `
          <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;">
            <h2 style="color:#2563eb;">📢 ${title}</h2>
            <p>Dear <strong>${u.name}</strong>,</p>
            <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:16px;margin:16px 0;border-radius:0 8px 8px 0;">
              <p style="margin:0;">${message}</p>
            </div>
            <a href="https://college-erp-frontend-rho.vercel.app" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Open EduERP</a>
          </div>
        `);
      }
    }

    res.status(201).json({ notif, message: 'Notification sent!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin Stats ──
app.get('/api/admin/stats', protect, restrictTo('admin'), async (req, res) => {
  try {
    const [students, activeStudents, teachers, pendingFees] = await Promise.all([
      Student.countDocuments(),
      Student.countDocuments({ status: 'active' }),
      User.countDocuments({ role: 'teacher' }),
      Fee.countDocuments({ status: 'pending' }),
    ]);
    res.json({ totalStudents: students, activeStudents, totalTeachers: teachers, pendingFees });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Fee Receipt Email Route ──
app.post('/api/fees/receipt', async (req, res) => {
  try {
    const { studentName, email, rollNo, amount, receipt, mode, semester, date, totalFee, totalPaid, totalDue } = req.body;

    await sendEmail(email, 'Fee Payment Receipt — EduERP 🎓', `
      <div style="font-family:sans-serif;max-width:550px;margin:auto;padding:20px;background:#f9f9f9;">
        <div style="background:white;border-radius:12px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <div style="text-align:center;margin-bottom:24px;">
            <div style="font-size:48px;">🎉</div>
            <h2 style="color:#16a34a;margin:8px 0;">Payment Successful!</h2>
            <p style="color:#666;font-size:14px;margin:0;">Aapki fee payment confirm ho gayi hai</p>
          </div>

          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px;margin-bottom:20px;text-align:center;">
            <p style="margin:0;font-size:14px;color:#15803d;">Amount Paid</p>
            <p style="margin:8px 0 0;font-size:36px;font-weight:800;color:#16a34a;">₹${amount.toLocaleString()}</p>
          </div>

          <div style="background:#f8f9fa;border-radius:10px;padding:20px;margin-bottom:20px;">
            <h3 style="margin:0 0 16px;font-size:15px;color:#333;">📋 Receipt Details</h3>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 0;color:#666;font-size:13px;border-bottom:1px dashed #e5e7eb;">Receipt No</td><td style="padding:8px 0;font-weight:bold;font-size:13px;text-align:right;border-bottom:1px dashed #e5e7eb;">${receipt}</td></tr>
              <tr><td style="padding:8px 0;color:#666;font-size:13px;border-bottom:1px dashed #e5e7eb;">Student Name</td><td style="padding:8px 0;font-weight:bold;font-size:13px;text-align:right;border-bottom:1px dashed #e5e7eb;">${studentName}</td></tr>
              <tr><td style="padding:8px 0;color:#666;font-size:13px;border-bottom:1px dashed #e5e7eb;">Roll Number</td><td style="padding:8px 0;font-weight:bold;font-size:13px;text-align:right;border-bottom:1px dashed #e5e7eb;">${rollNo}</td></tr>
              <tr><td style="padding:8px 0;color:#666;font-size:13px;border-bottom:1px dashed #e5e7eb;">Semester</td><td style="padding:8px 0;font-weight:bold;font-size:13px;text-align:right;border-bottom:1px dashed #e5e7eb;">${semester}</td></tr>
              <tr><td style="padding:8px 0;color:#666;font-size:13px;border-bottom:1px dashed #e5e7eb;">Payment Date</td><td style="padding:8px 0;font-weight:bold;font-size:13px;text-align:right;border-bottom:1px dashed #e5e7eb;">${date}</td></tr>
              <tr><td style="padding:8px 0;color:#666;font-size:13px;border-bottom:1px dashed #e5e7eb;">Payment Mode</td><td style="padding:8px 0;font-weight:bold;font-size:13px;text-align:right;border-bottom:1px dashed #e5e7eb;">${mode}</td></tr>
              <tr><td style="padding:8px 0;color:#666;font-size:13px;border-bottom:1px dashed #e5e7eb;">Amount Paid</td><td style="padding:8px 0;font-weight:bold;font-size:13px;color:#16a34a;text-align:right;border-bottom:1px dashed #e5e7eb;">₹${totalPaid.toLocaleString()}</td></tr>
              <tr><td style="padding:8px 0;color:#666;font-size:13px;">Balance Due</td><td style="padding:8px 0;font-weight:bold;font-size:13px;color:${totalDue>0?'#dc2626':'#16a34a'};text-align:right;">${totalDue>0?'₹'+totalDue.toLocaleString():'Nil ✅'}</td></tr>
            </table>
          </div>

          ${totalDue <= 0 ? '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;text-align:center;margin-bottom:20px;"><p style="margin:0;color:#16a34a;font-weight:bold;font-size:15px;">🎓 Aapki poori fee jama ho gayi hai! Badhaai ho!</p></div>' : ''}

          <div style="background:#eff6ff;border-radius:8px;padding:14px;margin-bottom:20px;">
            <p style="margin:0;font-size:12px;color:#1e40af;">🔒 Yeh payment EduERP secure payment system ke through process hui hai. Koi problem ho toh college office se contact karo.</p>
          </div>

          <div style="text-align:center;">
            <a href="https://college-erp-frontend-rho.vercel.app" style="background:#2563eb;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">EduERP Portal Kholo</a>
          </div>

          <p style="text-align:center;color:#999;font-size:11px;margin-top:20px;">EduERP College Management System · Auto-generated receipt</p>
        </div>
      </div>
    `);

    res.json({ success: true, message: 'Receipt email sent!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Email Test Route ──
app.get('/api/test-email', async (req, res) => {
  const result = await sendEmail(
    req.query.to || process.env.EMAIL_USER,
    'EduERP Email Test',
    '<h2>Email is working!</h2><p>Your EduERP email notifications are configured correctly.</p>'
  );
  res.json({ success: result, message: result ? 'Email sent!' : 'Email not configured' });
});

// ── Connect MongoDB ──
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/college_erp';
console.log('Connecting to MongoDB...');

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected successfully!');
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log('Server running on port ' + PORT));
  })
  .catch(err => {
    console.error('MongoDB connection failed: ' + err.message);
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log('Server running on port ' + PORT + ' (no DB)'));
  });
