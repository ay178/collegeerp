// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'teacher', 'admin'], required: true },
  profileRef: { type: mongoose.Schema.Types.ObjectId, refPath: 'role' },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

// ─────────────────────────────────────────────────────────────
// models/Student.js
const studentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rollNo: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: String,
  branch: { type: String, enum: ['CS', 'IT', 'ME', 'CE', 'EE', 'EC', 'CH', 'CV'], required: true },
  semester: { type: String, required: true },
  division: { type: String, enum: ['A', 'B', 'C'], required: true },
  status: { type: String, enum: ['active', 'inactive', 'graduated'], default: 'active' },
  admissionYear: Number,
  address: String,
}, { timestamps: true });

const Student = mongoose.model('Student', studentSchema);

// ─────────────────────────────────────────────────────────────
// models/Teacher.js
const teacherSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employeeId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: String,
  department: { type: String, required: true },
  designation: { type: String, default: 'Assistant Professor' },
  subjects: [{ type: String }],
  joiningDate: Date,
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true });

const Teacher = mongoose.model('Teacher', teacherSchema);

// ─────────────────────────────────────────────────────────────
// models/Attendance.js
const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
  subject: { type: String, required: true },
  date: { type: Date, required: true },
  status: { type: String, enum: ['present', 'absent', 'holiday'], default: 'absent' },
  semester: String,
  branch: String,
  division: String,
}, { timestamps: true });

attendanceSchema.index({ studentId: 1, subject: 1, date: 1 }, { unique: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);

// ─────────────────────────────────────────────────────────────
// models/Marks.js
const marksSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
  subject: { type: String, required: true },
  semester: { type: String, required: true },
  academicYear: { type: String, required: true },
  midterm1: { type: Number, default: 0, min: 0, max: 30 },
  midterm2: { type: Number, default: 0, min: 0, max: 30 },
  assignment: { type: Number, default: 0, min: 0, max: 20 },
  practical: { type: Number, default: 0, min: 0, max: 20 },
  totalMarks: { type: Number, default: 0 },
  grade: String,
  isPass: Boolean,
}, { timestamps: true });

// Auto-calculate total & grade before save
marksSchema.pre('save', function(next) {
  this.totalMarks = this.midterm1 + this.midterm2 + this.assignment + this.practical;
  const pct = this.totalMarks;
  this.grade = pct >= 80 ? 'A+' : pct >= 70 ? 'A' : pct >= 60 ? 'B+' : pct >= 50 ? 'B' : pct >= 40 ? 'C' : 'F';
  this.isPass = this.totalMarks >= 40;
  next();
});

marksSchema.index({ studentId: 1, subject: 1, semester: 1, academicYear: 1 }, { unique: true });

const Marks = mongoose.model('Marks', marksSchema);

module.exports = { User: mongoose.model('User', userSchema), Student, Teacher, Attendance, Marks };
