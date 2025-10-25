import tkinter as tk
import easygui as g
import pyautogui
import requests
main = tk.Tk()
def download():
     href = g.enterbox('请输入链接地址：')
     file = g.filesavebox('保存的地址：')
     pyautogui.alert('任务建立完毕，点击下面的按钮开始下载')
     r = requests.get(href)
     with open(file,'wb') as f:
          f.write(r.content)
     pyautogui.alert('下载已完成')
downloadbutton = tk.Button(main,text = '下载',command = download)
downloadbutton.pack()
main.title('下载器')
main.mainloop()
