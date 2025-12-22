#!/bin/bash
set -e

# 根目录和安装目录
ROOT_DIR="/workspace"
BIN_DIR="$ROOT_DIR/bin"
mkdir -p "$BIN_DIR"

# -----------------------------
# 安装 Go
# -----------------------------
GO_ARCHIVE="$ROOT_DIR/go1.25.5.linux-amd64.tar.gz"
GO_DIR="$BIN_DIR/go"

echo "解压 Go..."
rm -rf "$GO_DIR"
mkdir -p "$GO_DIR"
tar -C "$BIN_DIR" -xzf "$GO_ARCHIVE"

# -----------------------------
# 安装 Hugo Extended
# -----------------------------
HUGO_ARCHIVE="$ROOT_DIR/hugo_extended_0.152.2_Linux-64bit.tar.gz"
echo "解压 Hugo Extended..."
tar -C "$BIN_DIR" -xzf "$HUGO_ARCHIVE"

# -----------------------------
# 配置环境变量
# -----------------------------
if ! grep -qxF "export PATH=$BIN_DIR:\$PATH" "$HOME/.bashrc"; then
    echo "export PATH=$BIN_DIR:\$PATH" >> "$HOME/.bashrc"
fi
export PATH="$BIN_DIR:$PATH"

# -----------------------------
# 验证安装
# -----------------------------
echo "安装完成！"
"$BIN_DIR/go/bin/go" version
"$BIN_DIR/hugo" version
