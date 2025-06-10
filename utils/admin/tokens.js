import jwt from "jsonwebtoken";
export const generateAccessToken = (admin) => {
  return jwt.sign({ id: admin.id }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "15m",
  });
};

export const generateRefreshToken = (admin) => {
  return jwt.sign({ id: admin.id }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: "7d",
  });
};
