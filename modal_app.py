import os
import subprocess
from modal import App, Image, Secret, web_server

# 1. Define the App
app = App("eixora-backend")

# 2. Build the Environment
image = (
    Image.debian_slim()
    .apt_install("curl", "ffmpeg", "python3")
    # Install Node.js 20 and yt-dlp binary (latest)
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp",
        "chmod a+rx /usr/local/bin/yt-dlp"
    )
    # Copy Node dependencies
    .add_local_file("package.json", "/app/package.json", copy=True)
    .add_local_dir("prisma", "/app/prisma", copy=True)
    # Install NPM packages and generate Prisma Client
    .run_commands("cd /app && npm install && npx prisma generate")
    # Mount the rest of the code
    .add_local_dir(".", remote_path="/app", ignore=["node_modules", "uploads", ".next", ".git", "*.log"])
)

# 3. Start the Express Server
@app.function(
    image=image,
    secrets=[Secret.from_dotenv()],
    # Keep 1 container always warm for fast response
    min_containers=1,
    # Scale up to 10 containers under load — each handles concurrent requests
    # Modal auto-scales between min and max based on traffic
    max_containers=10,
    # Each container gets 2 CPUs and 2GB RAM — enough for ffmpeg + Node
    cpu=2,
    memory=2048,
    # Timeout per request — video processing can take up to 3 minutes
    timeout=180,
)
@web_server(8000, startup_timeout=90)
def express_server():
    env = os.environ.copy()
    env["PORT"] = "8000"
    # On Modal, use /tmp for file uploads — it's writable and fast
    # The uploads/ folder in the image is read-only after build
    env["UPLOAD_DIR"] = "/tmp/eixora_uploads"
    
    # Ensure upload dir exists
    os.makedirs("/tmp/eixora_uploads", exist_ok=True)
    
    print("🚀 [MODAL] Starting Eixora Node.js Server...")
    print(f"   Node version: {subprocess.check_output(['node', '--version']).decode().strip()}")
    print(f"   ffmpeg: {subprocess.check_output(['which', 'ffmpeg']).decode().strip()}")
    print(f"   yt-dlp: {subprocess.check_output(['which', 'yt-dlp']).decode().strip()}")
    
    # Use Popen (non-blocking) so Modal can finish initialization
    subprocess.Popen(["node", "index.js"], cwd="/app", env=env)
