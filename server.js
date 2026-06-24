import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));

app.get("/", function(req, res){
  res.json({
    success: true,
    message: "Trades AI Tool worker is running."
  });
});

app.get("/health", function(req, res){
  res.json({
    success: true,
    status: "healthy"
  });
});

app.listen(PORT, function(){
  console.log("Worker server running on port " + PORT);
});
