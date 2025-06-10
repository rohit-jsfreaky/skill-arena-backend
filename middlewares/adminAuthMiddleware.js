import jwt from "jsonwebtoken";

export const verifyAdmin = (req, res, next) => {
  const { admin } = req.query;

  console.log("Admin verification middleware triggered.", admin);
  // If admin query param is not true, bypass admin verification
  if (admin !== "true") {
    // Set a flag to indicate this is not an admin request
    req.isAdmin = false;
    return next();
  }

  // Proceed with admin verification since admin=true
  const token = req.cookies.accessToken;

  if (!token) {
    return res
      .status(401)
      .json({ message: "Admin access requires authentication token." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = { id: decoded.id, username: decoded.username };
    req.isAdmin = true;
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid or expired admin token." });
  }
};
