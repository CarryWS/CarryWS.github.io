'''
本程序由CarryWS制作，可以看我对于本程序的一个小片段：https://www.bilibili.com/video/BV1Wv411Y7jA
注：如发生报错，记得看看自己的Python有没有安装pyautogui库。
如果没有请执行以下命令：
pip install pyautogui
如有BUG请私信。
'''
import pyautogui
import tkinter as tk
import easygui as g
import time
import os
#代码部分
def keys():#键盘操作总函数
    choice = g.buttonbox('请选择','键盘操作',('输入（打字）','点按特殊按键（如esc,ctrl这些）'))#总选择框
    if choice == '输入（打字）':#判断如果
        keyname = g.enterbox('你要输入什么内容：')
        try:
            times = int(g.enterbox('要输入几次：（0次为无限输入）'))
            time.sleep(3)
            if times == 0:
                while True:
                    pyautogui.typewrite(keyname)
            else:
                for i in range(times):
                    pyautogui.typewrite(keyname)
        except:#输入格式错误
            pyautogui.alert('请输入一个整数')
    if choice == '点按特殊按键（如esc,ctrl这些）':
        keyname = g.enterbox('你要按下那个按键：')
        try:
            times = int(g.enterbox('按下次数：（0次为无限点击）'))
            time.sleep(3)
            if times == 0:
                while True:
                    pyautogui.press(keyname)
            else:
                for i in range(times):
                    pyautogui.press(keyname)
        except:
            pyautogui.alert('请输入一个整数')
def mouses():
    clicktype = g.enterbox('点击左键还是右键？（左键请输入l，右键请输入r，都是小写）')
    if clicktype == 'l':
        try:
            times = int(g.enterbox('点击多少次数：(0次为无限次数，注意，如果无限点击将会很难关闭，请克制)'))
            time.sleep(3)
            if times == 0:
                while True:
                    pyautogui.click(clicks = 1000,interval = 0.001)
            else:
                pyautogui.click(clicks = times)
        except pyautogui.FailSafeException:
            pyautogui.alert('已检测到当前可能已发生安全问题，已停止。','提示')
        except ValueError:
            pyautogui.alert('请输入一个整数')
    if clicktype == 'r':
        try:
            times = int(g.enterbox('点击多少次数：(0次为无限次数，注意，如果无限点击将会很难关闭，请克制)'))
            time.sleep(3)
            if times == 0:
                while True:
                    pyautogui.click(clicks = 1000,interval = 0.001,button = 'right')
            else:
                pyautogui.click(clicks = times,button = 'right')
        except pyautogui.FailSafeException:
            pyautogui.alert('已检测到当前可能已发生安全问题，已停止。','提示')
        except ValueError:
            pyautogui.alert('请输入一个整数')
def about():
    choice = g.buttonbox('主要支持键盘，鼠标的连续性操作，由CarryWS制作。','关于',('我知道了','跳转到作者的位置'))
    if choice == '我知道了':
        pass
    else:
        os.system('start https://space.bilibili.com/513556246')
main = tk.Tk()
keyboard = tk.Button(main,text = '键盘操作',command = keys)
mouse = tk.Button(main,text = '鼠标操作',command = mouses)
about_ = tk.Button(main,text = ' 关于 ',command = about)
keyboard.pack()
mouse.pack()
about_.pack()
main.geometry('175x100')
main.title('键盘鼠标操作 --Made by bilibili CarryWS')
main.mainloop()
