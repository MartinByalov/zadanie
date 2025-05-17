const ALLOWED_TEACHERS = process.env.ALLOWED_TEACHERS
  ? process.env.ALLOWED_TEACHERS.split(',').map(e => e.trim())
  : [];

module.exports = function requireTeacher(req, res, next) {
  if (!req.session?.teacher) {
    console.log('Access denied - no teacher session');
    return res.redirect('/teacher/login');
  }
  
  const email = req.session.teacher.email;

  if (!ALLOWED_TEACHERS.includes(email)) {
    console.log(`Access denied - email not allowed: ${email}`);
    return res.status(403).send('Teacher access only');
  }

  next();
};
