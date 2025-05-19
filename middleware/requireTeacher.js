function cleanSession(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  Object.keys(obj).forEach(key => {
    if (obj[key] === undefined) {
      obj[key] = null;
    } else if (typeof obj[key] === 'object') {
      cleanSession(obj[key]);
    }
  });
  return obj;
}

const ALLOWED_TEACHERS = process.env.ALLOWED_TEACHERS
  ? process.env.ALLOWED_TEACHERS.split(',').map(e => e.trim())
  : [];

function requireTeacher(req, res, next) {
  if (!req.session?.teacher) {
    console.log('Access denied - no teacher session');
    req.session.redirectTo = req.originalUrl;
    return res.redirect('/teacher/login');
  }

  cleanSession(req.session);

  const email = req.session.teacher.email;

  if (!ALLOWED_TEACHERS.includes(email)) {
    console.log(`Access denied - email not allowed: ${email}`);
    return res.status(403).send('Teacher access only');
  }

  next();
}

module.exports = {
  requireTeacher,
  cleanSession
};
