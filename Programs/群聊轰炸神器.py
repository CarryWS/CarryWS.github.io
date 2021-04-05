import pyautogui
import time
print('将在按下回车5秒后进行轰炸！按下回车以继续...',end = '')
input()
second = 5
while True:
    print('还有'+str(second)+'秒进行轰炸',end = '\r')
    time.sleep(1)
    second -= 1
    if second == 0:
        print('\n')
        times = 0
        while True:
            pyautogui.hotkey('ctrl','v')
            pyautogui.press('enter')
            times += 1
            print('已轰炸'+str(times)+'次',end = '\r')
