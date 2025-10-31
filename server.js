// ==========================================================
// ==          ملف الخادم المتكامل (server.js)            ==
// ==========================================================

// --- 1. استدعاء المكتبات المطلوبة ---
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const multer = require('multer'); // تم الإبقاء على هذا السطر (الصحيح)
const path = require('path');     // تم الإبقاء على هذا السطر (الصحيح)

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- إعداد Multer لتخزين الملفات ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/audio/'); // المجلد الذي سيتم حفظ الصوتيات فيه
    },
    filename: function (req, file, cb) {
        // إنشاء اسم فريد للملف لمنع التضارب
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// --- 2. إعدادات الخادم الأساسية ---
app.use(express.static(__dirname));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'a-very-secret-key-that-should-be-changed', // غيّر هذا النص العشوائي
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // اجعلها true إذا كنت تستخدم HTTPS
}));

// --- 3. إعداد قاعدة البيانات SQLite ---
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        return console.error('خطأ في الاتصال بقاعدة البيانات:', err.message);
    }
    console.log('تم الاتصال بقاعدة بيانات SQLite بنجاح.');
    db.serialize(() => {
        // جدول الأسئلة
        db.run(`CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            statement TEXT NOT NULL,
            answer TEXT NOT NULL,
            correction TEXT,
            simplifiedStatement TEXT,
            hint TEXT
        )`);
        
        // جدول الدروس
        db.run(`CREATE TABLE IF NOT EXISTS lessons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL
        )`);

        // جدول الصوتيات
        db.run(`CREATE TABLE IF NOT EXISTS audios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            duration TEXT,
            filePath TEXT NOT NULL
        )`);
        
        console.log('تم التأكد من وجود الجداول.');
    });
});


// ==========================================================
// =====   4. واجهة برمجة التطبيقات (API) للوحة التحكم  =====
// ==========================================================

// Middleware للتحقق من تسجيل الدخول
function checkAuth(req, res, next) {
    if (req.session.loggedin) {
        next();
    } else {
        res.redirect('/admin');
    }
}

// -- API للأسئلة --

// 🛑 **تصحيح هام:** تم حذف "checkAuth" من هنا للسماح للوضع الفردي بجلب الأسئلة
app.get('/api/questions', (req, res) => {
    db.all("SELECT * FROM questions ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.post('/api/questions', checkAuth, (req, res) => {
    const { statement, answer, correction, simplifiedStatement, hint } = req.body;
    db.run(`INSERT INTO questions (statement, answer, correction, simplifiedStatement, hint) VALUES (?, ?, ?, ?, ?)`,
        [statement, answer, correction, simplifiedStatement, hint], function (err) {
            if (err) return res.status(400).json({ error: err.message });
            res.json({ message: "تمت إضافة السؤال", id: this.lastID });
        });
});

app.delete('/api/questions/:id', checkAuth, (req, res) => {
    db.run("DELETE FROM questions WHERE id = ?", req.params.id, function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "تم حذف السؤال" });
    });
});


// -- API للدروس (كاملة مع الإضافة والحذف) --

// ✅ **الإضافة:** هذا الجزء كان مفقوداً. يسمح للصفحة الرئيسية بقراءة الدروس
app.get('/api/lessons', (req, res) => {
    db.all("SELECT * FROM lessons ORDER BY id", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.post('/api/lessons', checkAuth, (req, res) => {
    const { title, content } = req.body;
    db.run(`INSERT INTO lessons (title, content) VALUES (?, ?)`, [title, content], function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "تمت إضافة الدرس", id: this.lastID });
    });
});

app.delete('/api/lessons/:id', checkAuth, (req, res) => {
    db.run("DELETE FROM lessons WHERE id = ?", req.params.id, function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "تم حذف الدرس" });
    });
});


// -- API للصوتيات (كاملة مع الإضافة والحذف) --

// ✅ **الإضافة:** هذا الجزء كان مفقوداً. يسمح للصفحة الرئيسية بقراءة الصوتيات

// -- API للصوتيات (كاملة مع الإضافة والحذف ورفع الملفات) --

// GET يبقى كما هو
app.get('/api/audios', (req, res) => {
    db.all("SELECT * FROM audios ORDER BY id", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// POST تم تعديله بالكامل
app.post('/api/audios', checkAuth, upload.single('audioFile'), (req, res) => {
    const { title, duration } = req.body;
    
    // req.file يحتوي على معلومات الملف الذي تم رفعه بواسطة multer
    if (!req.file) {
        return res.status(400).json({ error: "الرجاء رفع ملف صوتي." });
    }
    
    // المسار الذي سيتم حفظه في قاعدة البيانات
    const filePath = `/uploads/audio/${req.file.filename}`;

    db.run(`INSERT INTO audios (title, duration, filePath) VALUES (?, ?, ?)`, [title, duration, filePath], function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "تمت إضافة المقطع الصوتي بنجاح", id: this.lastID });
    });
});

// DELETE يبقى كما هو
app.delete('/api/audios/:id', checkAuth, (req, res) => {
    // (يمكنك إضافة كود هنا لحذف الملف من الخادم أيضاً، لكن لنجعل الأمر بسيطاً الآن)
    db.run("DELETE FROM audios WHERE id = ?", req.params.id, function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "تم حذف المقطع الصوتي" });
    });
});

// ==========================================================
// =====   5. صفحات لوحة التحكم (Admin Panel)         =====
// ==========================================================
app.get('/admin', (req, res) => res.sendFile(__dirname + '/admin.html'));

app.post('/admin/login', (req, res) => {
    if (req.body.password === '12345') { // كلمة مرور بسيطة للتجربة
        req.session.loggedin = true;
        res.redirect('/dashboard');
    } else {
        res.status(401).send('كلمة المرور غير صحيحة!');
    }
});

app.get('/dashboard', checkAuth, (req, res) => res.sendFile(__dirname + '/dashboard.html'));


// ==========================================================
// =====   6. منطق اللعبة متعددة اللاعبين (Socket.io)   =====
// ==========================================================
let players = {};
let gameState = 'waiting';
let allQuestions = [];
let currentQuestionIndex = 0;
let questionStartTime;
const QUESTION_TIME = 15000;
const INTERMISSION_TIME = 5000;
let gameTimer;

// دالة لجلب الأسئلة من قاعدة البيانات
function loadQuestionsFromDB() {
    return new Promise((resolve, reject) => {
        // الآن نجلب كل الحقول التي تحتاجها اللعبة
        db.all("SELECT id, statement, answer FROM questions", [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                console.log(`تم تحميل ${rows.length} سؤالاً من قاعدة البيانات.`);
                // خلط الأسئلة عشوائياً
                allQuestions = rows.sort(() => Math.random() - 0.5);
                resolve();
            }
        });
    });
}

io.on('connection', (socket) => {
    console.log('لاعب جديد متصل:', socket.id);

    // استقبال اسم اللاعب
    socket.on('setPlayerName', (name) => {
        const cleanName = name.trim().slice(0, 15) || 'لاعب مجهول';
        players[socket.id] = {
            id: socket.id,
            name: cleanName,
            score: 0,
            answered: false
        };
        // إرسال قائمة اللاعبين المحدثة للجميع
        io.emit('currentPlayers', players);
        console.log(`تم تحديث اسم اللاعب ${socket.id} إلى ${cleanName}`);
    });

    // عند قطع الاتصال
    socket.on('disconnect', () => {
        console.log('لاعب قطع الاتصال:', socket.id);
        delete players[socket.id];
        io.emit('currentPlayers', players);
    });

    // عند بدء اللعبة
    socket.on('startGame', async () => {
        if (Object.keys(players).length > 1 && gameState === 'waiting') {
            try {
                await loadQuestionsFromDB();
                if (allQuestions.length === 0) {
                    io.emit('gameError', 'لا توجد أسئلة في قاعدة البيانات لبدء اللعبة!');
                    return;
                }
                gameState = 'playing';
                currentQuestionIndex = 0;
                Object.values(players).forEach(p => p.score = 0); // تصفير النقاط
                io.emit('currentPlayers', players); // إرسال النقاط المصفّرة
                sendNextQuestion();
            } catch (error) {
                console.error("فشل تحميل الأسئلة:", error);
                io.emit('gameError', 'حدث خطأ أثناء تحميل الأسئلة من قاعدة البيانات.');
            }
        }
    });

    // عند استقبال إجابة
    socket.on('submitAnswer', ({ questionId, answer }) => {
        const question = allQuestions[currentQuestionIndex];
        const player = players[socket.id];
        if (question && player && !player.answered) {
            player.answered = true;
            if (question.id == questionId && question.answer === answer) {
                const timeTaken = (Date.now() - questionStartTime) / 1000;
                const scoreEarned = Math.max(10, 100 + Math.floor((QUESTION_TIME / 1000 - timeTaken) * 10));
                player.score += scoreEarned;
            }
        }
    });
});

function sendNextQuestion() {
    Object.values(players).forEach(p => p.answered = false);
    if (currentQuestionIndex < allQuestions.length) {
        const question = allQuestions[currentQuestionIndex];
        questionStartTime = Date.now();
        io.emit('newQuestion', {
            id: question.id,
            statement: question.statement,
            questionNumber: currentQuestionIndex + 1,
            totalQuestions: allQuestions.length,
            duration: QUESTION_TIME
        });
        gameTimer = setTimeout(endRound, QUESTION_TIME);
    } else {
        endGame();
    }
}

function endRound() {
    clearTimeout(gameTimer);
    if (currentQuestionIndex < allQuestions.length) {
        const question = allQuestions[currentQuestionIndex];
        io.emit('roundResult', {
            correctAnswer: question.answer,
            players: players
        });
    }
    currentQuestionIndex++;
    setTimeout(sendNextQuestion, INTERMISSION_TIME);
}

function endGame() {
    gameState = 'finished';
    io.emit('gameOver', players);
    setTimeout(resetGame, 20000);
}

function resetGame() {
    gameState = 'waiting';
    currentQuestionIndex = 0;
    Object.values(players).forEach(p => p.score = 0);
    io.emit('gameReset', players);
    console.log('تمت إعادة تعيين اللعبة.');
}

// ==========================================================
// =====   7. تشغيل الخادم                             =====
// ==========================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`الخادم يعمل على الرابط http://localhost:${PORT}`);
    console.log(`لوحة التحكم متاحة على http://localhost:${PORT}/admin (كلمة المرور: 12345)`);
});