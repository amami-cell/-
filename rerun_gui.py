"""
rerun_gui.py
棚卸自動化 管理ツール
- 再集計タブ: 月を選んで再集計
- 店舗管理タブ: 店舗の追加・削除
- 取引先管理タブ: 取引先の追加・削除
"""
import sys
import re
import os
import threading
import subprocess
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
from datetime import datetime
import yaml


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.yaml")
MASTER_PATH = os.path.join(SCRIPT_DIR, "supplier_master.csv")


def strip_ansi(text):
    ansi_escape = re.compile(r'\x1b\[[0-9;]*m')
    return ansi_escape.sub('', text)


def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def save_config(config):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def load_master():
    rows = []
    if os.path.exists(MASTER_PATH):
        with open(MASTER_PATH, "r", encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if line and line != "取引先名,分類":
                    parts = line.split(",")
                    if len(parts) >= 2:
                        rows.append((parts[0], parts[1]))
    return rows


def save_master(rows):
    with open(MASTER_PATH, "w", encoding="utf-8-sig") as f:
        f.write("取引先名,分類\n")
        for name, cat in rows:
            f.write(f"{name},{cat}\n")


# ──────────────────────────────────────────
# タブ1: 再集計
# ──────────────────────────────────────────
def build_rerun_tab(notebook):
    tab = ttk.Frame(notebook)
    notebook.add(tab, text="  再集計  ")

    tk.Label(tab, text="対象月を選んで再集計", font=("メイリオ", 13, "bold")).pack(pady=10)

    frame = tk.Frame(tab)
    frame.pack(pady=5)

    tk.Label(frame, text="対象年：", font=("メイリオ", 11)).grid(row=0, column=0, padx=5)
    now = datetime.now()
    year_var = tk.StringVar(value=str(now.year))
    ttk.Spinbox(frame, from_=2020, to=2099, textvariable=year_var, width=8, font=("メイリオ", 11)).grid(row=0, column=1, padx=5)
    tk.Label(frame, text="年", font=("メイリオ", 11)).grid(row=0, column=2, padx=2)

    tk.Label(frame, text="対象月：", font=("メイリオ", 11)).grid(row=0, column=3, padx=5)
    prev_month = now.month - 1 if now.month > 1 else 12
    month_var = tk.StringVar(value=str(prev_month))
    ttk.Spinbox(frame, from_=1, to=12, textvariable=month_var, width=5, font=("メイリオ", 11)).grid(row=0, column=4, padx=5)
    tk.Label(frame, text="月", font=("メイリオ", 11)).grid(row=0, column=5, padx=2)

    tk.Label(tab, text="実行ログ：", font=("メイリオ", 9)).pack(anchor='w', padx=20)
    log_widget = scrolledtext.ScrolledText(tab, height=15, state='disabled', font=("Consolas", 9))
    log_widget.pack(fill='both', expand=True, padx=20, pady=5)

    btn = tk.Button(tab, text="▶ 再集計を実行", font=("メイリオ", 12, "bold"),
                    bg="#4CAF50", fg="white", padx=20, pady=6, cursor="hand2")

    def run_automation():
        def task():
            try:
                btn.configure(state='disabled', text='実行中...')
                log_widget.configure(state='normal')
                log_widget.delete('1.0', tk.END)
                log_widget.configure(state='disabled')

                target = f"{year_var.get()}-{str(month_var.get()).zfill(2)}"
                log_widget.configure(state='normal')
                log_widget.insert(tk.END, f"=== {target} の再集計を開始 ===\n")
                log_widget.configure(state='disabled')

                env = os.environ.copy()
                env["PYTHONIOENCODING"] = "utf-8"
                result = subprocess.run(
                    [sys.executable, "main.py", "--month", target],
                    cwd=SCRIPT_DIR, capture_output=True, text=True,
                    encoding='utf-8', errors='replace', env=env
                )

                log_widget.configure(state='normal')
                if result.stdout:
                    log_widget.insert(tk.END, strip_ansi(result.stdout))
                if result.stderr:
                    log_widget.insert(tk.END, "\n[エラー出力]\n" + strip_ansi(result.stderr))
                log_widget.insert(tk.END, "\n=== 完了 ===\n")
                log_widget.see(tk.END)
                log_widget.configure(state='disabled')

                if result.returncode == 0:
                    messagebox.showinfo("完了", f"{target} の再集計が完了しました！")
                else:
                    messagebox.showwarning("完了（警告あり）", f"{target} の再集計が完了しました。\nログを確認してください。")
            except Exception as e:
                messagebox.showerror("エラー", str(e))
            finally:
                btn.configure(state='normal', text='▶ 再集計を実行')

        threading.Thread(target=task, daemon=True).start()

    btn.configure(command=run_automation)
    btn.pack(pady=8)
    return tab


# ──────────────────────────────────────────
# タブ2: 店舗管理
# ──────────────────────────────────────────
def build_store_tab(notebook):
    tab = ttk.Frame(notebook)
    notebook.add(tab, text="  店舗管理  ")

    tk.Label(tab, text="店舗の追加・削除", font=("メイリオ", 13, "bold")).pack(pady=10)

    # 店舗一覧
    list_frame = tk.Frame(tab)
    list_frame.pack(fill='both', expand=True, padx=20, pady=5)

    cols = ("store_id", "store_name", "file_prefix")
    tree = ttk.Treeview(list_frame, columns=cols, show='headings', height=10)
    tree.heading("store_id", text="店舗ID")
    tree.heading("store_name", text="店舗名")
    tree.heading("file_prefix", text="ファイルプレフィックス")
    tree.column("store_id", width=80)
    tree.column("store_name", width=300)
    tree.column("file_prefix", width=200)

    sb = ttk.Scrollbar(list_frame, orient='vertical', command=tree.yview)
    tree.configure(yscrollcommand=sb.set)
    tree.pack(side='left', fill='both', expand=True)
    sb.pack(side='right', fill='y')

    def refresh_tree():
        tree.delete(*tree.get_children())
        try:
            config = load_config()
            for s in config.get("stores", []):
                tree.insert('', 'end', values=(
                    s.get("store_id", ""),
                    s.get("store_name", ""),
                    s.get("file_prefix", "")
                ))
        except Exception as e:
            messagebox.showerror("エラー", f"config.yaml の読み込みに失敗: {e}")

    refresh_tree()

    # 追加フォーム
    form_frame = tk.LabelFrame(tab, text="新規店舗を追加", font=("メイリオ", 10))
    form_frame.pack(fill='x', padx=20, pady=5)

    tk.Label(form_frame, text="店舗ID：", font=("メイリオ", 10)).grid(row=0, column=0, padx=5, pady=4, sticky='e')
    id_var = tk.StringVar()
    tk.Entry(form_frame, textvariable=id_var, width=12, font=("メイリオ", 10)).grid(row=0, column=1, padx=5, pady=4)

    tk.Label(form_frame, text="店舗名：", font=("メイリオ", 10)).grid(row=0, column=2, padx=5, pady=4, sticky='e')
    name_var = tk.StringVar()
    tk.Entry(form_frame, textvariable=name_var, width=30, font=("メイリオ", 10)).grid(row=0, column=3, padx=5, pady=4)

    tk.Label(form_frame, text="ファイルプレフィックス：", font=("メイリオ", 10)).grid(row=0, column=4, padx=5, pady=4, sticky='e')
    prefix_var = tk.StringVar()
    tk.Entry(form_frame, textvariable=prefix_var, width=20, font=("メイリオ", 10)).grid(row=0, column=5, padx=5, pady=4)

    def add_store():
        sid = id_var.get().strip()
        sname = name_var.get().strip()
        sprefix = prefix_var.get().strip()
        if not sid or not sname or not sprefix:
            messagebox.showerror("エラー", "全ての項目を入力してください")
            return
        try:
            config = load_config()
            stores = config.get("stores", [])
            if any(str(s.get("store_id")) == sid for s in stores):
                messagebox.showerror("エラー", f"店舗ID {sid} は既に存在します")
                return
            stores.append({"store_id": sid, "store_name": sname, "file_prefix": sprefix})
            config["stores"] = stores
            save_config(config)
            id_var.set("")
            name_var.set("")
            prefix_var.set("")
            refresh_tree()
            messagebox.showinfo("完了", f"店舗 {sname} を追加しました")
        except Exception as e:
            messagebox.showerror("エラー", str(e))

    def delete_store():
        selected = tree.selection()
        if not selected:
            messagebox.showwarning("警告", "削除する店舗を選択してください")
            return
        item = tree.item(selected[0])
        sid, sname = item['values'][0], item['values'][1]
        if not messagebox.askyesno("確認", f"店舗 {sname}（ID:{sid}）を削除しますか？"):
            return
        try:
            config = load_config()
            config["stores"] = [s for s in config.get("stores", []) if str(s.get("store_id")) != str(sid)]
            save_config(config)
            refresh_tree()
            messagebox.showinfo("完了", f"店舗 {sname} を削除しました")
        except Exception as e:
            messagebox.showerror("エラー", str(e))

    btn_frame = tk.Frame(form_frame)
    btn_frame.grid(row=1, column=0, columnspan=6, pady=5)
    tk.Button(btn_frame, text="＋ 追加", font=("メイリオ", 10, "bold"),
              bg="#2196F3", fg="white", padx=15, pady=4, cursor="hand2",
              command=add_store).pack(side='left', padx=10)
    tk.Button(btn_frame, text="－ 選択した店舗を削除", font=("メイリオ", 10),
              bg="#f44336", fg="white", padx=15, pady=4, cursor="hand2",
              command=delete_store).pack(side='left', padx=10)

    return tab


# ──────────────────────────────────────────
# タブ3: 取引先管理
# ──────────────────────────────────────────
def build_master_tab(notebook):
    tab = ttk.Frame(notebook)
    notebook.add(tab, text="  取引先管理  ")

    tk.Label(tab, text="取引先の追加・削除（フード/ドリンク/備品）", font=("メイリオ", 13, "bold")).pack(pady=10)

    list_frame = tk.Frame(tab)
    list_frame.pack(fill='both', expand=True, padx=20, pady=5)

    cols = ("name", "category")
    tree = ttk.Treeview(list_frame, columns=cols, show='headings', height=12)
    tree.heading("name", text="取引先名")
    tree.heading("category", text="分類")
    tree.column("name", width=380)
    tree.column("category", width=100)

    sb = ttk.Scrollbar(list_frame, orient='vertical', command=tree.yview)
    tree.configure(yscrollcommand=sb.set)
    tree.pack(side='left', fill='both', expand=True)
    sb.pack(side='right', fill='y')

    def refresh_tree():
        tree.delete(*tree.get_children())
        for name, cat in load_master():
            tree.insert('', 'end', values=(name, cat))

    refresh_tree()

    form_frame = tk.LabelFrame(tab, text="新規取引先を追加", font=("メイリオ", 10))
    form_frame.pack(fill='x', padx=20, pady=5)

    tk.Label(form_frame, text="取引先名：", font=("メイリオ", 10)).grid(row=0, column=0, padx=5, pady=4, sticky='e')
    name_var = tk.StringVar()
    tk.Entry(form_frame, textvariable=name_var, width=40, font=("メイリオ", 10)).grid(row=0, column=1, padx=5, pady=4)

    tk.Label(form_frame, text="分類：", font=("メイリオ", 10)).grid(row=0, column=2, padx=5, pady=4, sticky='e')
    cat_var = tk.StringVar(value="フード")
    ttk.Combobox(form_frame, textvariable=cat_var, values=["フード", "ドリンク", "備品"],
                 width=10, font=("メイリオ", 10), state='readonly').grid(row=0, column=3, padx=5, pady=4)

    def add_supplier():
        name = name_var.get().strip()
        cat = cat_var.get().strip()
        if not name:
            messagebox.showerror("エラー", "取引先名を入力してください")
            return
        rows = load_master()
        if any(r[0] == name for r in rows):
            messagebox.showerror("エラー", f"「{name}」は既に登録されています")
            return
        rows.append((name, cat))
        save_master(rows)
        name_var.set("")
        refresh_tree()
        messagebox.showinfo("完了", f"取引先「{name}」を{cat}として追加しました")

    def delete_supplier():
        selected = tree.selection()
        if not selected:
            messagebox.showwarning("警告", "削除する取引先を選択してください")
            return
        item = tree.item(selected[0])
        name, cat = item['values'][0], item['values'][1]
        if not messagebox.askyesno("確認", f"「{name}」を削除しますか？"):
            return
        rows = [r for r in load_master() if r[0] != name]
        save_master(rows)
        refresh_tree()
        messagebox.showinfo("完了", f"取引先「{name}」を削除しました")

    btn_frame = tk.Frame(form_frame)
    btn_frame.grid(row=1, column=0, columnspan=4, pady=5)
    tk.Button(btn_frame, text="＋ 追加", font=("メイリオ", 10, "bold"),
              bg="#2196F3", fg="white", padx=15, pady=4, cursor="hand2",
              command=add_supplier).pack(side='left', padx=10)
    tk.Button(btn_frame, text="－ 選択した取引先を削除", font=("メイリオ", 10),
              bg="#f44336", fg="white", padx=15, pady=4, cursor="hand2",
              command=delete_supplier).pack(side='left', padx=10)

    return tab


# ──────────────────────────────────────────
# メイン
# ──────────────────────────────────────────
def main():
    root = tk.Tk()
    root.title("棚卸自動化 管理ツール")
    root.geometry("800x600")
    root.resizable(True, True)

    tk.Label(root, text="棚卸自動化 管理ツール", font=("メイリオ", 15, "bold")).pack(pady=8)

    notebook = ttk.Notebook(root)
    notebook.pack(fill='both', expand=True, padx=10, pady=5)

    build_rerun_tab(notebook)
    build_store_tab(notebook)
    build_master_tab(notebook)

    root.mainloop()


if __name__ == "__main__":
    main()
