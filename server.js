require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const JWT_SECRET = process.env.JWT_SECRET || 'edu_erp_secret_2025';

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'EduERP API running', version: '3.0.0' }));

// ── Email ──
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const sendEmail = async (to, subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return false;
  try {
    await transporter.sendMail({ from: '"EduERP" <' + process.env.EMAIL_USER + '>', to, subject, html });
    return true;
  } catch (err) { console.error('Email error:', err.message); return false; }
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

const feeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  studentName: String, rollNo: String, semester: String,
  amount: Number, paid: { type: Number, default: 0 },
  dueDate: Date, status: { type: String, default: 'pending' },
}, { timestamps: true });
const Fee = mongoose.model('Fee', feeSchema);

const examSchema = new mongoose.Schema({
  subject: String, examType: String, date: Date,
  time: String, room: String, branch: String,
  semester: String, duration: String,
}, { timestamps: true });
const Exam = mongoose.model('Exam', examSchema);

// ── Chat Schema ──
const chatSchema = new mongoose.Schema({
  senderId:   { type: String, required: true },
  senderName: { type: String, required: true },
  receiverId: { type: String, required: true },
  message:    { type: String, required: true },
  time:       { type: String },
  read:       { type: Boolean, default: false },
}, { timestamps: true });
const Chat = mongoose.model('Chat', chatSchema);

// ── Middleware ──
const protect = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ message: 'Not authorized' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch (e) { res.status(401).json({ message: 'Invalid token' }); }
};

const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ message: 'Access denied' });
  next();
};

// ── Socket.io — Real-time Chat ──
const onlineUsers = new Map(); // userId -> socketId

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User online ho gaya
  socket.on('user_online', (userId) => {
    onlineUsers.set(userId, socket.id);
    io.emit('online_users', Array.from(onlineUsers.keys()));
    console.log('Online users:', Array.from(onlineUsers.keys()));
  });

  // Message bheja
  socket.on('send_message', async (data) => {
    try {
      const { senderId, senderName, receiverId, message } = data;
      const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

      // MongoDB mein save karo
      const chat = await Chat.create({ senderId, senderName, receiverId, message, time });

      const msgData = {
        _id:        chat._id,
        senderId,
        senderName,
        receiverId,
        message,
        time,
        createdAt:  chat.createdAt,
        read:       false,
      };

      // Sender ko bhejo
      socket.emit('receive_message', msgData);

      // Receiver online hai toh usse bhi bhejo
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', msgData);
      }
    } catch (err) {
      console.error('Message error:', err.message);
    }
  });

  // Typing indicator
  socket.on('typing', (data) => {
    const receiverSocketId = onlineUsers.get(data.receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user_typing', { senderId: data.senderId });
    }
  });

  socket.on('stop_typing', (data) => {
    const receiverSocketId = onlineUsers.get(data.receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user_stop_typing', { senderId: data.senderId });
    }
  });

  // Message read kiya
  socket.on('mark_read', async (data) => {
    await Chat.updateMany(
      { senderId: data.senderId, receiverId: data.receiverId, read: false },
      { read: true }
    );
  });

  // Disconnect
  socket.on('disconnect', () => {
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        break;
      }
    }
    io.emit('online_users', Array.from(onlineUsers.keys()));
    console.log('User disconnected:', socket.id);
  });
});

// ── Chat REST Routes ──
// Get conversation history
app.get('/api/chat/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const myId = req.user.id;
    const messages = await Chat.find({
      $or: [
        { senderId: myId,   receiverId: userId },
        { senderId: userId, receiverId: myId   },
      ]
    }).sort({ createdAt: 1 }).limit(100);
    res.json(messages);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Get all teachers for chat list
app.get('/api/chat/teachers/list', protect, async (req, res) => {
  try {
    const teachers = await User.find({ role: 'teacher', _id: { $ne: req.user.id } })
      .select('_id name email role');
    res.json(teachers);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Get unread count
app.get('/api/chat/unread/:senderId', protect, async (req, res) => {
  try {
    const count = await Chat.countDocuments({
      senderId: req.params.senderId,
      receiverId: req.user.id,
      read: false,
    });
    res.json({ count });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Seed Route ──
app.get('/api/seed', async (req, res) => {
  try {
    const users = [
      { name: 'Dr. Ramesh Kumar',    email: 'admin@edu.com',    password: 'admin123',   role: 'admin'   },
      { name: 'Prof. Anjali Singh',  email: 'teacher@edu.com',  password: 'teach123',   role: 'teacher' },
      { name: 'Prof. Vicky Sharma',  email: 'vicky@edu.com',    password: 'vicky123',   role: 'teacher' },
      { name: 'Prof. Ranjita Verma', email: 'ranjita@edu.com',  password: 'ranjita123', role: 'teacher' },
      { name: 'Dr. Suresh Nair',     email: 'teacher2@edu.com', password: 'teach123',   role: 'teacher' },
      { name: 'Prof. Meena Rao',     email: 'teacher3@edu.com', password: 'teach123',   role: 'teacher' },
      { name: 'Arjun Mehta',         email: 'student@edu.com',  password: 'stud123',    role: 'student' },
    ];
    const results = [];
    for (const u of users) {
      const existing = await User.findOne({ email: u.email });
      if (!existing) { await User.create(u); results.push('Created: ' + u.email); }
      else { results.push('Already exists: ' + u.email); }
    }
    res.json({ message: 'Seed done!', results });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Auth Routes ──
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const user = await User.findOne({ email, role });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already exists' });
    const user = await User.create({ name, email, password, role });
    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    await sendEmail(email, 'Welcome to EduERP!', `<h2>Welcome ${name}!</h2><p>Your account has been created.</p><p>Role: ${role}</p>`);
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { res.status(500).json({ message: err.message }); }
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
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/students', protect, restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.create(req.body);
    if (student.email) {
      await sendEmail(student.email, 'Welcome to EduERP!', `
        <h2>Welcome ${student.name}!</h2>
        <p>Roll No: ${student.rollNo}</p>
        <p>Password: ${student.rollNo}</p>
        <a href="https://erp-frontend-ebon-theta.vercel.app">Login Now</a>
      `);
    }
    res.status(201).json(student);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

app.put('/api/students/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(student);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

app.delete('/api/students/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Student deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
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
    res.json({ message: 'Attendance saved' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/api/attendance/student/:id', protect, async (req, res) => {
  try {
    const records = await Attendance.find({ studentId: req.params.id });
    res.json(records);
  } catch (err) { res.status(500).json({ message: err.message }); }
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
    res.json({ message: 'Marks saved' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/api/marks/student/:id', protect, async (req, res) => {
  try {
    const marks = await Marks.find({ studentId: req.params.id });
    res.json(marks);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Fee Receipt Route ──
app.post('/api/fees/receipt', async (req, res) => {
  try {
    const { studentName, email, rollNo, amount, receipt, mode, semester, date, totalFee, totalPaid, totalDue } = req.body;
    await sendEmail(email, 'Fee Payment Receipt — EduERP', `
      <h2>Payment Successful!</h2>
      <p>Amount: Rs.${amount}</p>
      <p>Receipt: ${receipt}</p>
      <p>Student: ${studentName} (${rollNo})</p>
    `);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Admin Routes ──
app.get('/api/admin/stats', protect, restrictTo('admin'), async (req, res) => {
  try {
    const [students, activeStudents] = await Promise.all([
      Student.countDocuments(),
      Student.countDocuments({ status: 'active' }),
    ]);
    res.json({ totalStudents: students, activeStudents });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Email Test ──
app.get('/api/test-email', async (req, res) => {
  const result = await sendEmail(req.query.to || process.env.EMAIL_USER, 'EduERP Test', '<h2>Email working!</h2>');
  res.json({ success: result, message: result ? 'Email sent!' : 'Email not configured' });
});

// ── MongoDB Connect ──
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/college_erp';
console.log('Connecting to MongoDB...');

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected successfully!');
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => console.log('Server running on port ' + PORT));
  })
  .catch(err => {
    console.error('MongoDB connection failed: ' + err.message);
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => console.log('Server running on port ' + PORT + ' (no DB)'));
  });
