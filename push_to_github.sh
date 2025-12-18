#!/bin/bash

# 一键推送 Hugo 网站到 GitHub

# 项目根目录
PROJECT_DIR="/workspace/blog/hugo"

# 进入项目目录
cd "$PROJECT_DIR" || { echo "目录不存在: $PROJECT_DIR"; exit 1; }

# 检查是否有修改
if git diff-index --quiet HEAD --; then
    echo "✅ 没有新修改，无需提交"
    exit 0
fi

# 设置提交信息
read -p "输入本次提交信息: " COMMIT_MSG
if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="更新网站内容"
fi

# 添加所有修改
git add .

# 提交
git commit -m "$COMMIT_MSG"

# 推送到远程仓库
git push origin main

# 完成提示
echo "🚀 网站已成功推送到 GitHub!"
