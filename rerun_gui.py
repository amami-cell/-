"""
rerun_gui.py
棚卸自動化 管理ツール（4タブ構成）
  棚卸取得  : 月指定でインフォマート取得・集計
  FW取得    : 月指定＋月末/中間でFoodist Journal取得
  店舗管理  : config.yaml 店舗追加・削除
  取引先管理 : supplier_master.csv 追加・削除
"""
import sys
import re
import os
import threading
import subprocess
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
from datetime import date
import yaml


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.yaml")
MASTER_PATH = os.path.join(SCRIPT_DIR, "supplier_master.csv")


def strip_ansi(text):
    ansi_escape = re.compile(r'\x1b\[[0-9;]*m')
    return ansi_escape.sub('', text)


def recent_months(n=13):
    """直近 n ヶ月の YYYY-MM 文字列リストを返す（当月が先頭）"""
    months = []
    today = date.today()
    year, month = today.year, today.month
    for _ in range(n):
        months.append(f"{year}-{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return months


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


def run_subprocess(args, log_widget, btn, btn_label, start_msg=None, on_done=None):
    """subprocess をバックグラウンドスレッドで実行し、ログを log_widget に流す。"""
    def task():
        try:
            btn.configure(state='disabled', text='実行中...')
            log_widget.configure(state='normal')
            log_widget.delete('1.0', tk.END)
            if start_msg:
                log_widget.insert(tk.END, start_msg + "\n")
            log_widget.configure(state='disabled')

            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            result = subprocess.run(
                args, cwd=SCRIPT_DIR,
                capture_output=True, text=True,
                encoding='utf-8', errors='replace', env=env,
            )

            log_widget.configure(state='normal')
            if result.stdout:
                log_widget.insert(tk.END, strip_ansi(result.stdout))
            if result.stderr:
                log_widget.insert(tk.END, "\n[エラー出力]\n" + strip_ansi(result.stderr))
            log_widget.insert(tk.END, "\n=== 完了 ===\n")
            log_widget.see(tk.END)
            log_widget.configure(state='disabled')

            if on_done:
                on_done(result.returncode == 0)
            elif result.returncode == 0:
                messagebox.showinfo("完了", "処理が完了しました！")
            else:
                messagebox.showwarning("完了（警告あり）", "処理が完了しました。\nログを確認してください。")
        except Exception as e:
            messagebox.showerror("エラー", str(e))
        finally:
            btn.configure(state='normal', text=btn_label)

    threading.Thread(target=task, daemon=True).start()


# ──────────────────────────────────────────
# タブ1: 棚卸取得（インフォマート）
# ──────────────────────────────────────────
def build_infomart_tab(notebook):
    tab = ttk.Frame(notebook)
    notebook.add(tab, text="  棚卸取得  ")

    tk.Label(tab, text="棚卸取得（インフォマート）", font=("メイリオ", 13, "bold")).pack(pady=10)

    sel_frame = tk.Frame(tab)
    sel_frame.pack(pady=5)
    tk.Label(sel_frame, text="対象月：", font=("メイリオ", 11)).grid(row=0, column=0, padx=5)
    months = recent_months()
    month_var = tk.StringVar(value=months[1])  # デフォルト: 前月
    ttk.Combobox(sel_frame, textvariable=month_var, values=months,
                 width=12, font=("メイリオ", 11), state='readonly').grid(row=0, column=1, padx=5)
    tk.Label(sel_frame, text="（同月データがある場合は上書き更新）",
             font=("メイリオ", 9), fg="#777").grid(row=0, column=2, padx=10)

    tk.Label(tab, text="実行ログ：", font=("メイリオ", 9)).pack(anchor='w', padx=20, pady=(8, 0))
    log_widget = scrolledtext.ScrolledText(tab, height=16, state='disabled', font=("Consolas", 9))
    log_widget.pack(fill='both', expand=True, padx=20, pady=5)

    btn_label = "▶ 取り込み開始"
    btn = tk.Button(tab, text=btn_label, font=("メイリオ", 12, "bold"),
                    bg="#4CAF50", fg="white", padx=20, pady=6, cursor="hand2")

    def run():
        m = month_var.get().strip()
        if not m:
            messagebox.showerror("エラー", "対象月を選択してください")
            return

        def on_done(success):
            if success:
                messagebox.showinfo("完了", f"{m} の棚卸取得が完了しました！")
            else:
                messagebox.showwarning("完了（警告あり）",
                                       f"{m} の棚卸取得が完了しました。\nログを確認してください。")

        run_subprocess(
            [sys.executable, "main.py", "--month", m],
            log_widget, btn, btn_label,
            start_msg=f"=== {m} の棚卸取得を開始 ===",
            on_done=on_done,
        )

    btn.configure(command=run)
    btn.pack(pady=8)
    return tab


# ──────────────────────────────────────────
# タブ2: FW取得（Foodist Journal）
# ──────────────────────────────────────────
def build_fw_tab(notebook):
    tab = ttk.Frame(notebook)
    notebook.add(tab, text="  FW取得  ")

    tk.Label(tab, text="FW取得（Foodist Journal）", font=("メイリオ", 13, "bold")).pack(pady=10)

    sel_frame = tk.Frame(tab)
    sel_frame.pack(pady=5)
    tk.Label(sel_frame, text="対象月：", font=("メイリオ", 11)).grid(row=0, column=0, padx=5)
    months = recent_months()
    month_var = tk.StringVar(value=months[1])  # デフォルト: 前月
    ttk.Combobox(sel_frame, textvariable=month_var, values=months,
                 width=12, font=("メイリオ", 11), state='readonly').grid(row=0, column=1, padx=5)

    radio_frame = tk.Frame(tab)
    radio_frame.pack(pady=6)
    tk.Label(radio_frame, text="取得期間：", font=("メイリオ", 11)).grid(row=0, column=0, padx=5)
    kind_var = tk.StringVar(value="月末")
    tk.Radiobutton(radio_frame, text="月末（1日〜月末）", variable=kind_var, value="月末",
                   font=("メイリオ", 11)).grid(row=0, column=1, padx=8)
    tk.Radiobutton(radio_frame, text="中間（1日〜15日）", variable=kind_var, value="中間",
                   font=("メイリオ", 11)).grid(row=0, column=2, padx=8)

    tk.Label(tab, text="実行ログ：", font=("メイリオ", 9)).pack(anchor='w', padx=20, pady=(8, 0))
    log_widget = scrolledtext.ScrolledText(tab, height=16, state='disabled', font=("Consolas", 9))
    log_widget.pack(fill='both', expand=True, padx=20, pady=5)

    btn_label = "▶ 取り込み開始"
    btn = tk.Button(tab, text=btn_label, font=("メイリオ", 12, "bold"),
                    bg="#2196F3", fg="white", padx=20, pady=6, cursor="hand2")

    def run():
        m = month_var.get().strip()
        k = kind_var.get()
        if not m:
            messagebox.showerror("エラー", "対象月を選択してください")
            return

        args = [sys.executable, "main.py", "--foodist-only", "--month", m]
        if k == "中間":
            args.append("--interim")

        period = "中間（〜15日）" if k == "中間" else "月末（〜末日）"

        def on_done(success):
            if success:
                messagebox.showinfo("完了", f"{m} [{period}] のFW取得が完了しました！")
            else:
                messagebox.showwarning("完了（警告あり）",
                                       f"FW取得が完了しました。\nログを確認してください。")

        run_subprocess(
            args, log_widget, btn, btn_label,
            start_msg=f"=== {m} FW取得 [{period}] 開始 ===",
            on_done=on_done,
        )

    btn.configure(command=run)
    btn.pack(pady=8)
    return tab


# ──────────────────────────────────────────
# タブ3: 店舗管理
# ──────────────────────────────────────────
def build_store_tab(notebook):
    tab = ttk.Frame(notebook)
    notebook.add(tab, text="  店舗管理  ")

    tk.Label(tab, text="店舗の追加・削除", font=("メイリオ", 13, "bold")).pack(pady=10)

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
# タブ4: 取引先管理
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
    root.geometry("820x620")
    root.resizable(True, True)

    tk.Label(root, text="棚卸自動化 管理ツール", font=("メイリオ", 15, "bold")).pack(pady=8)

    notebook = ttk.Notebook(root)
    notebook.pack(fill='both', expand=True, padx=10, pady=5)

    build_infomart_tab(notebook)
    build_fw_tab(notebook)
    build_store_tab(notebook)
    build_master_tab(notebook)

    root.mainloop()


if __name__ == "__main__":
    main()
