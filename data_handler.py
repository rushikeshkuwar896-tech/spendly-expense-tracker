import pandas as pd
import os

DATA_FILE = 'data/expenses.csv'

def initialize_data():
    if not os.path.exists('data'):
        os.makedirs('data')
    if not os.path.exists(DATA_FILE):
        df = pd.DataFrame(columns=['Date', 'Category', 'Amount', 'Notes'])
        df.to_csv(DATA_FILE, index=False)

def add_expense(date, category, amount, notes):
    df = pd.read_csv(DATA_FILE)
    new_data = pd.DataFrame([[str(date), category, amount, notes]], columns=df.columns)
    df = pd.concat([df, new_data], ignore_index=True)
    df.to_csv(DATA_FILE, index=False)

def load_data():
    if os.path.exists(DATA_FILE):
        return pd.read_csv(DATA_FILE)
    return pd.DataFrame(columns=['Date', 'Category', 'Amount', 'Notes'])