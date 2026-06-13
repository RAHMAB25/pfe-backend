import jwt from "jsonwebtoken"

class TokenService {

// 🔐 Middleware pour vérifier JWT
verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Access denied" });
  }
   
  const token = authHeader.split(" ")[1];
  try {
    const verified = jwt.verify(token, "secretkey");
    req.user = verified;
    next();
  } catch (err) {
    return res.status(400).json({ error: "Invalid token" });
  }
  };
}

export default TokenService