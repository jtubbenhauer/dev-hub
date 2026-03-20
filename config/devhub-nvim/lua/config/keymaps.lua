local map = vim.keymap.set

-- Quick save
map("n", "<leader>w", "<cmd>w<cr>", { desc = "Save file" })

-- Quick quit
map("n", "<leader>q", "<cmd>q<cr>", { desc = "Quit" })

-- Clear search highlight
map("n", "<Esc>", "<cmd>noh<cr>", { desc = "Clear search highlight" })

-- Window navigation
map("n", "<C-h>", "<C-w>h", { desc = "Move to left window" })
map("n", "<C-j>", "<C-w>j", { desc = "Move to below window" })
map("n", "<C-k>", "<C-w>k", { desc = "Move to above window" })
map("n", "<C-l>", "<C-w>l", { desc = "Move to right window" })

-- Buffer navigation
map("n", "<S-h>", "<cmd>bprevious<cr>", { desc = "Previous buffer" })
map("n", "<S-l>", "<cmd>bnext<cr>", { desc = "Next buffer" })

-- Diff shortcuts
map("n", "<leader>do", "<cmd>DiffviewOpen<cr>", { desc = "Open diffview" })
map("n", "<leader>dc", "<cmd>DiffviewClose<cr>", { desc = "Close diffview" })
map("n", "<leader>dh", "<cmd>DiffviewFileHistory %<cr>", { desc = "File history (current)" })
map("n", "<leader>dH", "<cmd>DiffviewFileHistory<cr>", { desc = "File history (all)" })
